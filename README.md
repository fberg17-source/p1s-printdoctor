# PrintDoctor

Appen er en AI-assistent for feilsøking på 3D-utskrifter for alle vanlige FDM-printere og slicere (Bambu Lab, Prusa, Creality, Elegoo, Anycubic, Qidi, Sovol, Voron m.fl.). Den sender oppsett, beskrivelse og bilde til en egen Netlify Function. Funksjonen kaller Google Gemini, og API-nøkkelen ligger bare der, aldri i appen.

```
app/        Expo-appen (App.js, app.json, eas.json, .env.example)
backend/    Netlify-site med funksjonen /api/analyze
```

## Hva er endret fra Snack-versjonen

- **AI-kallet virket ikke.** Det gikk til `https://pollinations.ai`, som er forsiden og ikke et API, så svaret var HTML eller ingenting. Det var heller ikke Gemini, slik overleveringen sa.
- **Bildet ble aldri sendt til AI-en.** Bare teksten gikk med. Nå skaleres bildet til maks 1280 px bredde, komprimeres og sendes med.
- **Forhåndsvisningen av bildet virket ikke.** `assets` ble brukt i stedet for `assets[0]`.
- Prompten ligger nå på serveren. Appen sender bare valgene, og serveren sjekker dem mot en fast liste. Da kan ikke andre bruke proxyen som et gratis, generelt AI-API.
- Æ, ø og å er rettet. Før sto det «foerst», «paa» og så videre.
- Det er lagt til tidsavbrudd (60 s), en «Fjern bilde»-knapp og en tegngrense på beskrivelsen.

## 1. Backend (Netlify)

Gjøres én gang, på PC/Mac:

```bash
cd backend
npm install
npm install -g netlify-cli
netlify login
netlify init                     # velg «Create & configure a new site», f.eks. p1s-printdoctor-api
```

Legg inn miljøvariabler. Det kan også gjøres i Netlify-panelet under Site configuration → Environment variables.

```bash
netlify env:set GEMINI_API_KEY "din-nye-nøkkel"
netlify env:set APP_TOKEN "$(openssl rand -hex 32)"
netlify env:set DAILY_LIMIT 200          # valgfri
netlify env:set GEMINI_MODEL gemini-flash-latest   # valgfri – "gemini-flash-latest" følger alltid nyeste Flash
netlify deploy --prod
```

Skriv ned verdien av `APP_TOKEN` (`netlify env:get APP_TOKEN`). Den skal også inn i appen.

Test:
```bash
curl -X POST https://DITT-SITENAVN.netlify.app/api/analyze \
  -H "Content-Type: application/json" -H "x-app-token: DIN_TOKEN" \
  -d '{"filament":"PLA","nozzle":"0.4 mm","plate":"Textured PEI","problem":"hjørnene løfter seg"}'
```

**Om dagsgrensen:** `DAILY_LIMIT` begrenser det totale antallet analyser per døgn (UTC), lagret i Netlify Blobs. `APP_TOKEN` ligger i appen og kan trekkes ut av en som virkelig vil, så det er grensen som beskytter mot en stor regning. Sett også et budsjett og et varsel i Google Cloud for prosjektet som eier nøkkelen.

## 2. Appen (Expo)

`app/` er et komplett Expo-prosjekt (SDK 58), som er sjekket med `expo config` og `expo export`.

```bash
cd app
npm install
```

Lag `.env` ut fra `.env.example`:

```
EXPO_PUBLIC_API_URL=https://DITT-SITENAVN.netlify.app/api/analyze
EXPO_PUBLIC_APP_TOKEN=samme verdi som APP_TOKEN
```

`.env` er allerede lagt i `.gitignore`. Ikonene er fortsatt Expo-standard.

Start: `npx expo start`, og skann QR-koden med Expo Go.

## 3. Bygg for Google Play

```bash
npm install -g eas-cli
eas login                                  # @graybeard
eas init                                   # kobler prosjektet til Expo-kontoen
eas build --platform android --profile preview      # APK til testing på egen telefon
eas build --platform android --profile production   # .aab til Play Console
```

`.env`-variablene blir med i EAS-bygget når filen ligger i prosjektmappa og ikke er ekskludert av `.easignore`. Alternativt kan de legges inn som EAS environment variables på expo.dev.

Øk `versionCode` i `app.json` for hver nye opplasting til Play.

## Gjenstår

- Ikon og splash (1024×1024 PNG)
- Personvernerklæring og Data safety-skjemaet: bilder og tekst sendes til Google Gemini for analyse og lagres ikke av appen
- Lukket test med minst 12 testere i 14 dager før produksjonstilgang
