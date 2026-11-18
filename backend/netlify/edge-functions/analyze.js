// Netlify Edge Function: proxy mellom PrintDoctor-appen og Google Gemini.
// API-nøkkelen ligger kun her (miljøvariabel GEMINI_API_KEY), aldri i appen.
//
// Miljøvariabler (Netlify → Site configuration → Environment variables):
//   GEMINI_API_KEY  – nøkkel fra aistudio.google.com/apikey (påkrevd)
//   APP_TOKEN       – lang tilfeldig streng, samme som EXPO_PUBLIC_APP_TOKEN i appen (påkrevd)
//   GEMINI_MODEL    – valgfri, standard "gemini-flash-latest"
//   DAILY_LIMIT     – valgfri, maks antall analyser per døgn totalt, standard 200

import { getStore } from '@netlify/blobs';

// Edge-funksjon i stedet for vanlig funksjon: vanlige funksjoner stoppes etter 10 s på gratisplanen,
// mens edge-funksjoner kan vente på Gemini så lenge svaret starter innen ca. 40 s.

const ALLOWED = {
  // Gamle verdier ('ABS / ASA', 'PAHT-CF') beholdes så eldre app-versjoner fortsatt virker.
  filament: ['PLA', 'PETG', 'ABS', 'ASA', 'ABS / ASA', 'TPU', 'Nylon / PA', 'PC', 'Karbonfiber-blanding', 'PAHT-CF', 'Annet'],
  nozzle: ['0.4 mm', '0.2 mm', '0.6 mm', '0.8 mm'],
  plate: ['Textured PEI', 'Smooth PEI', 'Glass', 'Cool Plate / Supertack', 'Annet'],
  brand: ['Bambu Lab', 'Prusa', 'Creality', 'Elegoo', 'Anycubic', 'Qidi', 'Sovol', 'Voron / Klipper', 'Annen'],
  slicer: ['Bambu Studio', 'OrcaSlicer', 'PrusaSlicer', 'Cura', 'Creality Print', 'Annen'],
};
const MAX_MODEL_CHARS = 60;
const MAX_PROBLEM_CHARS = 1000;
const MAX_IMAGE_BASE64_CHARS = 4_000_000; // per bilde
const MAX_TOTAL_IMAGE_CHARS = 5_000_000; // alle bilder samlet
const MAX_IMAGES = 3;
const MAX_HISTORY = 20; // meldinger i samtalen
const MAX_HISTORY_CHARS = 8000; // per melding
const MAX_FOLLOWUP_CHARS = 1000;

const SYSTEM_PROMPT = `Du er en erfaren ekspert på FDM 3D-printing og kjenner alle vanlige printere (Bambu Lab, Prusa, Creality, Elegoo, Anycubic, Qidi, Sovol, Voron/Klipper m.fl.) og slicere (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Creality Print).
Du får brukerens printer, slicer, filament, dyse og byggeplate, en beskrivelse og ofte ett til tre bilder av utskriften.

Slik vurderer du bildene:
- Se nøye etter konkrete kjennetegn: lagforskyvning, under-/overekstrudering, stringing, blobs/zits, warping/løftede hjørner, elefantfot, ringing/ghosting, dårlig brobygging, overheng som henger, lag som sprekker (dårlig lagheft), spaghetti, Z-banding, hull i toppflater, dårlig første lag.
- Beskriv hvor på objektet du ser feilen (f.eks. "fra ca. halve høyden", "på overhenget til venstre").
- Skill mellom det du faktisk ser og det du antar. Er bildet uklart, for langt unna eller viser noe annet enn beskrivelsen: si det, og si hvilket bilde som ville hjulpet (nærbilde, fra siden, undersiden).
- Ranger de mest sannsynlige årsakene, mest sannsynlig først.

Tilpass rådene til akkurat den printeren og sliceren: bruk slicerens egne navn på innstillingene og menyene, og ta hensyn til lukket kammer, direct drive eller bowden, auto-nivellering, Klipper/Marlin osv. Er modellen ukjent, gi råd som passer bredt og si hva som avhenger av printeren.
Svar konkret på norsk, i ren tekst uten markdown (ingen **, #, eller tabeller).

FØRSTE SVAR i en samtale skal ha denne strukturen:
1. DIAGNOSE (hva du ser, hvor, og hvor sikker du er)
2. SANNSYNLIGE ÅRSAKER (mest sannsynlig først)
3. SLICER-INNSTILLINGER (eksakte verdier og hvor i sliceren de ligger)
4. FYSISK SJEKK PÅ PRINTEREN
5. TEST FØRST (det ene enkleste tiltaket å prøve først)

OPPFØLGINGSSPØRSMÅL: svar direkte og kort på det brukeren spør om, uten å gjenta hele strukturen. Husk hva som er sagt tidligere i samtalen.
Hvis bildet ikke viser en 3D-utskrift, eller du er usikker, si det heller enn å gjette.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-token',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

const handler = async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Kun POST er tillatt.' }, 405);

  const apiKey = Netlify.env.get('GEMINI_API_KEY');
  const appToken = Netlify.env.get('APP_TOKEN');
  if (!apiKey || !appToken) return json({ error: 'Serveren er ikke konfigurert.' }, 500);
  if (req.headers.get('x-app-token') !== appToken) return json({ error: 'Ikke autorisert.' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400);
  }

  const { filament, nozzle, plate } = body || {};
  // Eldre app-versjoner sender ikke printer/slicer – da antas Bambu Lab P1S.
  const brand = body?.brand ?? 'Bambu Lab';
  const slicer = body?.slicer ?? 'Bambu Studio';
  const printerModel = typeof body?.model === 'string' ? body.model.trim() : body?.brand ? '' : 'P1S';
  if (!ALLOWED.brand.includes(brand) || !ALLOWED.slicer.includes(slicer) || printerModel.length > MAX_MODEL_CHARS) {
    return json({ error: 'Ugyldig valg av printer eller slicer.' }, 400);
  }
  const problem = typeof body?.problem === 'string' ? body.problem.trim() : '';

  if (!ALLOWED.filament.includes(filament) || !ALLOWED.nozzle.includes(nozzle) || !ALLOWED.plate.includes(plate)) {
    return json({ error: 'Ugyldig valg av filament, dyse eller plate.' }, 400);
  }
  if (problem.length > MAX_PROBLEM_CHARS) return json({ error: 'Beskrivelsen er for lang.' }, 400);

  // Bilder: ny app sender images[], eldre app sender image.
  const rawImages = Array.isArray(body?.images) ? body.images : body?.image ? [body.image] : [];
  if (rawImages.length > MAX_IMAGES) return json({ error: 'Maks ' + MAX_IMAGES + ' bilder.' }, 400);
  const imageParts = [];
  let totalChars = 0;
  for (const img of rawImages) {
    if (!img || img.mimeType !== 'image/jpeg' || typeof img.data !== 'string' || !img.data) {
      return json({ error: 'Ugyldig bilde.' }, 400);
    }
    if (img.data.length > MAX_IMAGE_BASE64_CHARS) return json({ error: 'Bildet er for stort.' }, 413);
    totalChars += img.data.length;
    imageParts.push({ inline_data: { mime_type: 'image/jpeg', data: img.data } });
  }
  if (totalChars > MAX_TOTAL_IMAGE_CHARS) return json({ error: 'Bildene er for store til sammen.' }, 413);
  const imagePart = imageParts[0] || null;

  // Samtale: tidligere meldinger + nytt oppfølgingsspørsmål
  const followup = typeof body?.followup === 'string' ? body.followup.trim() : '';
  if (followup.length > MAX_FOLLOWUP_CHARS) return json({ error: 'Spørsmålet er for langt.' }, 400);
  const history = Array.isArray(body?.history) ? body.history : [];
  if (history.length > MAX_HISTORY) return json({ error: 'Samtalen er for lang. Start en ny analyse.' }, 400);
  for (const m of history) {
    if (!m || !['user', 'model'].includes(m.role) || typeof m.text !== 'string' || m.text.length > MAX_HISTORY_CHARS) {
      return json({ error: 'Ugyldig samtalehistorikk.' }, 400);
    }
  }
  if (followup && history.length === 0) return json({ error: 'Oppfølging krever et tidligere svar.' }, 400);

  if (!problem && !imagePart) return json({ error: 'Send et bilde eller en beskrivelse.' }, 400);

  // Enkel dagsgrense for hele tjenesten, så en lekket token ikke kan gi en stor regning.
  const limit = Number(Netlify.env.get('DAILY_LIMIT') || 200);
  let store;
  try { store = getStore('printdoctor-usage'); } catch { store = null; }
  const dayKey = new Date().toISOString().slice(0, 10);
  try {
    if (!store) throw new Error('ingen store');
    const used = Number((await store.get(dayKey)) || 0);
    if (used >= limit) return json({ error: 'Dagsgrensen er nådd. Prøv igjen i morgen.' }, 429);
    await store.set(dayKey, String(used + 1));
  } catch (e) {
    console.error('Blobs-feil (dagsgrense hoppes over):', e?.message);
  }

  const userText =
    `Printer: ${brand}${printerModel ? ' ' + printerModel : ' (modell ikke oppgitt)'}. Slicer: ${slicer}. ` +
    `Filament: ${filament}. Dyse: ${nozzle}. Byggeplate: ${plate}.\n` +
    `Brukerens beskrivelse: ${problem || '(ingen – vurder bildet)'}`;

  const parts = [{ text: userText }, ...imageParts];
  // Første melding er alltid oppsett + bilder; deretter samtalen og evt. nytt spørsmål.
  const contents = [{ role: 'user', parts }];
  if (followup) {
    for (const m of history) contents.push({ role: m.role, parts: [{ text: m.text }] });
    contents.push({ role: 'user', parts: [{ text: followup }] });
  }

  // Prøv hovedmodellen først. Er den overbelastet (503/429/500) eller treg, prøv en lettere modell.
  const primary = Netlify.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
  const models = [...new Set([primary, 'gemini-flash-lite-latest'])];
  const started = Date.now();
  const TOTAL_BUDGET_MS = 36000; // edge-funksjonen må svare innen ca. 40 s

  const callGemini = async (model, withThinking, timeoutMs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 4096,
              ...(withThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
            },
          }),
        },
      );
    } finally {
      clearTimeout(t);
    }
  };

  let geminiRes = null;
  let data = null;
  let lastErr = 'ukjent';
  for (let i = 0; i < models.length; i++) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 4000) break;
    // Gi hovedmodellen mesteparten av tida, men la det være igjen til reserven.
    const timeoutMs = i === 0 && models.length > 1 ? Math.min(22000, left - 10000) : left;
    try {
      geminiRes = await callGemini(models[i], true, timeoutMs);
      if (geminiRes.status === 400) geminiRes = await callGemini(models[i], false, Math.max(3000, TOTAL_BUDGET_MS - (Date.now() - started)));
      data = await geminiRes.json().catch(() => null);
      if (geminiRes.ok) break;
      lastErr = geminiRes.status + ' ' + (data?.error?.message || '').slice(0, 140);
      console.error('Gemini-feil', models[i], lastErr);
      if (![429, 500, 503, 504, 404].includes(geminiRes.status)) break;
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'tidsavbrudd hos ' + models[i] : 'nettverksfeil';
      console.error('Gemini-kall feilet', models[i], lastErr);
      geminiRes = null;
    }
  }

  if (!geminiRes || !geminiRes.ok) {
    return json({ error: 'AI-tjenesten svarte med feil: ' + lastErr }, 502);
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'ukjent';
    return json({ error: 'AI-en ga ikke noe svar (' + reason + ').' }, 502);
  }

  return json({ text });
};

export default async (req) => {
  try {
    return await handler(req);
  } catch (e) {
    console.error('Uventet feil', e);
    return json({ error: 'Uventet serverfeil: ' + String(e?.message || e).slice(0, 160) }, 500);
  }
};

export const config = { path: '/api/analyze' };
