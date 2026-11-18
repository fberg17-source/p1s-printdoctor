# Overlevering – P1S PrintDoctor

*Oppdatert 17.11.2026. Erstatter den forrige overleveringen, som hadde feil om hvordan appen virket.*

## 1. Hva appen er

- **Navn:** P1S PrintDoctor
- **Formål:** AI-assistent for feilsøking på Bambu Lab P1S med AMS og Bambu Studio. Brukeren tar bilde av utskriften og velger filament, dyse og byggeplate. Så kommer et kort svar på norsk i tre deler: diagnose, Bambu Studio-innstillinger og fysisk sjekk.
- **Pakkenavn (Android):** `no.graybeard.p1sprintdoctor`
- **Kontoer:** Expo `@graybeard`, Google AI Studio (Gemini-nøkkel), Netlify (samme konto som chibinichi.no)

## 2. Hva som var galt i Snack-versjonen

Den forrige overleveringen sa at appen brukte Gemini. Det stemte ikke.

| Feil | Følge |
|---|---|
| AI-kallet gikk til `https://pollinations.ai` (forsiden, ikke et API) | AI-analysen har aldri virket |
| Bildet ble ikke sendt med i AI-kallet | «Bildediagnose» fantes bare i grensesnittet |
| `assets` ble brukt i stedet for `assets[0]` | Forhåndsvisningen av bildet viste ingenting |
| «foerst», «paa», «ennaa» | Æ, ø og å manglet |

Det lå ingen API-nøkkel i Snack-koden. Nøkkelen som slutter på **…amrQ** har likevel stått i en chat og skal slettes.

## 3. Arkitektur nå

```
Telefon (Expo-app)
   │  POST /api/analyze   { filament, nozzle, plate, problem, image(base64 JPEG) }
   │  header x-app-token
   ▼
Netlify Function (backend/netlify/edge-functions/analyze.js (edge-funksjon, slipper 10 s-grensa))
   │  sjekker token, gyldige valg, størrelse og dagsgrense
   │  prompten ligger her, ikke i appen
   ▼
Google Gemini API (gemini-flash-latest, kan endres med GEMINI_MODEL)
```

**Sikkerhet**
- `GEMINI_API_KEY` ligger bare som miljøvariabel i Netlify.
- `APP_TOKEN` ligger i appen. Den stopper tilfeldig misbruk, men kan trekkes ut av appen.
- `DAILY_LIMIT` (standard 200 per døgn, lagret i Netlify Blobs) er det som faktisk hindrer en stor regning.
- Serveren godtar bare de faste valgene, maks 1000 tegn beskrivelse og maks ca. 3 MB bilde. Den kan derfor ikke brukes som et generelt AI-API.
- **Anbefalt i tillegg:** budsjett og varsel i Google Cloud for prosjektet som eier nøkkelen.

## 4. Filer (p1s-printdoctor.zip i Claude-prosjekter)

```
README.md                     tekniske kommandoer (PC-veien)
HANDOVER.md                   dette dokumentet
app/                          komplett Expo-prosjekt, SDK 58
  App.js                      hele appen
  app.json                    navn, pakkenavn, versionCode, tillatelsestekster
  eas.json                    preview (APK) og production (.aab)
  .env.example                EXPO_PUBLIC_API_URL og EXPO_PUBLIC_APP_TOKEN
  package.json, index.js, assets/
backend/                      Netlify-site
  netlify/edge-functions/analyze.js (edge-funksjon, slipper 10 s-grensa)
  netlify.toml, package.json, public/index.html
```

**Testet:** Backend-logikken er testet med et falskt Gemini-svar: feil token gir 401, ugyldige valg gir 400, gyldig kall gir 200, og dagsgrensen gir 429. Appen bygger uten feil (`expo export`).
**Ikke testet ennå:** ekte Gemini-kall, og appen på en fysisk telefon.

## 5. Oppsett – kun mobil (ingen PC)

Krever at koden ligger i et GitHub-repo, for eksempel privat `fberg17-source/p1s-printdoctor`. Claude kan opprette det og laste opp koden.

**A. Ny Gemini-nøkkel**
1. Gå til aistudio.google.com/apikey, slett nøkkelen som slutter på …amrQ og lag en ny.
2. Ta vare på den nye nøkkelen privat. Ikke lim den inn i chat eller kode.

**B. Backend på Netlify (nettleser)**
1. Gå til app.netlify.com og velg *Add new site → Import an existing project → GitHub*.
2. Velg repoet. Sett *Base directory* til `backend` og *Publish directory* til `public` (relativt til `backend`).
3. Legg inn disse under *Site configuration → Environment variables*:
   - `GEMINI_API_KEY`: den nye nøkkelen
   - `APP_TOKEN`: en lang tilfeldig streng, gjerne fra en passordgenerator med 40 tegn eller mer
   - `DAILY_LIMIT`: 200 (valgfri)
4. Kjør *Deploys → Trigger deploy*. Noter adressen, for eksempel `https://p1s-printdoctor-api.netlify.app`.
5. Sjekk at forsiden viser «P1S PrintDoctor API».

**C. Rask test i Snack (uten å bygge)**
1. Lim inn den nye `App.js` i Snacken.
2. Snack har ikke `.env`. Bytt derfor ut `process.env.EXPO_PUBLIC_API_URL` og `process.env.EXPO_PUBLIC_APP_TOKEN` midlertidig med de faktiske verdiene. **Snacken må da være satt til private eller unlisted.**
3. Legg til `expo-image-manipulator` som avhengighet hvis Snack ber om det.
4. Test i Expo Go med bilde og tekst.

**D. Bygg på expo.dev (nettleser)**
1. Lag prosjektet `p1s-printdoctor` på expo.dev under `@graybeard` og koble det til GitHub-repoet (*Project settings → GitHub*). Sett base-mappe til `app`.
2. Legg inn disse under *Environment variables*, for både *preview* og *production*:
   - `EXPO_PUBLIC_API_URL` = `https://DITT-SITENAVN.netlify.app/api/analyze`
   - `EXPO_PUBLIC_APP_TOKEN` = samme verdi som `APP_TOKEN`
3. Start bygget fra GitHub-integrasjonen. Bruk profilen **preview** for en APK du kan installere rett på telefonen, og **production** for .aab til Play.
4. Expo trenger et prosjekt-ID i `app.json` (`extra.eas.projectId`). Det vises på prosjektsiden på expo.dev. Gi det til Claude, så legges det inn i repoet.

## 6. Oppsett – med PC

Se README.md: `netlify init`/`deploy`, `npm install` i `app/`, deretter `eas init` og `eas build`.

## 7. Google Play

1. Opprett en utviklerkonto på play.google.com/console. Det koster en engangsavgift på 25 USD og krever ID-verifisering.
2. Opprett appen og last opp .aab fra production-bygget.
3. **Personvernerklæring:** Den må ligge på en offentlig URL og kan for eksempel legges som en side på Netlify-siten. Den må si at bilder og tekst sendes til Google Gemini for analyse, at appen ikke lagrer dem, og at det ikke finnes kontoer eller sporing.
4. **Data safety-skjemaet:** Oppgi at bilder og brukerinnhold deles med en tredjepart (Google) for appens funksjon, og at de ikke lagres og ikke brukes til reklame.
5. **Lukket test:** Nye personlige utviklerkontoer må ha minst 12 testere som har vært med sammenhengende i 14 dager før de kan søke om produksjonstilgang.
6. Øk `versionCode` i `app.json` for hver ny opplasting.

## 8. Gjenstår

- [ ] Slette nøkkelen som slutter på …amrQ og lage en ny
- [ ] GitHub-repo
- [ ] Netlify-backend i drift og testet mot ekte Gemini
- [ ] Testet på telefon (Snack eller preview-APK)
- [ ] Eget ikon og splash (1024×1024 PNG), nå Expo-standard
- [ ] Personvernerklæring (norsk og engelsk) og svar til Data safety-skjemaet
- [ ] Play-utviklerkonto, lukket test med 12 testere i 14 dager
- [ ] Valgfritt: Markdown-visning av svaret, lagre tidligere analyser lokalt, grense per enhet i tillegg til den totale
