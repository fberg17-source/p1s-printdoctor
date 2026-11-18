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
const MAX_IMAGE_BASE64_CHARS = 4_000_000; // ca. 3 MB bilde; Netlify-grensa er 6 MB per forespørsel

const SYSTEM_PROMPT = `Du er en ekspert på FDM 3D-printing og kjenner alle vanlige printere (Bambu Lab, Prusa, Creality, Elegoo, Anycubic, Qidi, Sovol, Voron/Klipper m.fl.) og slicere (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Creality Print).
Du får brukerens printer, slicer, filament, dyse og byggeplate, en beskrivelse og eventuelt et bilde av utskriften.
Tilpass rådene til akkurat den printeren og sliceren: bruk slicerens egne navn på innstillingene og menyene, og ta hensyn til om printeren har lukket kammer, direct drive eller bowden, auto-nivellering osv. Er modellen ukjent, gi råd som passer bredt og si hva som avhenger av printeren.
Svar kort og konkret på norsk, i ren tekst uten markdown (ingen **, #, eller tabeller).
Strukturer svaret slik:
1. DIAGNOSE (1–2 setninger. Hvis bildet viser noe annet enn beskrivelsen, si det.)
2. SLICER-INNSTILLINGER (eksakte verdier og hvor i sliceren de ligger)
3. FYSISK SJEKK PÅ PRINTEREN (f.eks. rengjør plata, kjøling, dyse, tørk filament, nivellering, beltestramming)
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

  const { filament, nozzle, plate, image } = body || {};
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

  let imagePart = null;
  if (image) {
    if (image.mimeType !== 'image/jpeg' || typeof image.data !== 'string' || !image.data) {
      return json({ error: 'Ugyldig bilde.' }, 400);
    }
    if (image.data.length > MAX_IMAGE_BASE64_CHARS) return json({ error: 'Bildet er for stort.' }, 413);
    imagePart = { inline_data: { mime_type: 'image/jpeg', data: image.data } };
  }
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

  const parts = [{ text: userText }];
  if (imagePart) parts.push(imagePart);

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
            contents: [{ role: 'user', parts }],
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
