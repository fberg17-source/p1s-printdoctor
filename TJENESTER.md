# P1S PrintDoctor – tjenester og kontoer

*17.11.2026. Denne lista erstatter den fra den andre AI-en. Supabase, Firebase og Pollinations brukes ikke.*

## Dette brukes
| Tjeneste | Hva den gjør | Status |
|---|---|---|
| **Expo Go** (app på telefonen) | Tester appen før den bygges | Installert |
| **expo.dev** (@graybeard) | Bygger APK og .aab i skyen, rett fra nettleseren | Konto finnes. Prosjektet må opprettes og kobles til GitHub |
| **snack.expo.dev** | Den gamle testversjonen. Kan brukes til raske tester | Finnes |
| **GitHub** (fberg17-source) | Lagrer koden. Netlify og expo.dev henter derfra | Repoet `p1s-printdoctor` (privat) må opprettes |
| **Netlify** | Backend (`/api/analyze`) som skjuler Gemini-nøkkelen og har dagsgrense | Konto finnes. Siden må opprettes fra repoet, med base-mappe `backend` |
| **Google AI Studio** (aistudio.google.com/apikey) | Gemini-nøkkelen | **Slett nøkkelen som slutter på …amrQ og lag en ny.** Den nye legges bare i Netlify |
| **Google Play Console** (play.google.com/console) | Publisering. Engangsavgift 25 USD og lukket test med 12 testere i 14 dager | Senere |

## Hemmeligheter – hvor de skal ligge
| Navn | Hvor | Aldri |
|---|---|---|
| `GEMINI_API_KEY` | Netlify → Environment variables | i appen, i chat eller i GitHub |
| `APP_TOKEN` | Netlify, og samme verdi som `EXPO_PUBLIC_APP_TOKEN` på expo.dev | i GitHub |
| `EXPO_PUBLIC_API_URL` | expo.dev → Environment variables | – |

## Trengs bare om du får PC
Node.js, VS Code og EAS CLI. Se README.md.

## Rekkefølge (kun mobil)
1. Lag en ny Gemini-nøkkel og slett den gamle.
2. Opprett det tomme private repoet `p1s-printdoctor` på github.com/new. Claude legger inn koden.
3. Netlify: Import from Git, velg base `backend` og legg inn nøkkel og token.
4. Test i Snack med den nye App.js.
5. expo.dev: lag prosjektet, koble det til GitHub (mappe `app`), legg inn variablene og bygg med preview-profilen (APK).
6. Personvernerklæring og Data safety.
7. Play Console.
