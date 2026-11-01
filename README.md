# ImmunTrack

Immunisation data verified at the source. Pilot for Alimosho LGA, Lagos State.

ImmunTrack has two parts in one web app:

- **Vaccinator app (phone).** Collect and return the vaccine box, register a child (unique ID, QR card, face photo, birth certificate and LASRA ID), record each dose with GPS, time, a point-of-care photo, batch, injection site and a guardian SMS code. Works offline and syncs later.
- **Supervisor dashboard (laptop).** Live activity, verification rates, flagged records with map, photo and audit-trail evidence, tamper-proof sealed records, vaccine stock and box reconciliation, defaulter reminders, monthly reports, CSV and DHIS2 export.

## Setup (about 15 minutes)

1. **Supabase.** Create a new project (or use an existing one: every object is prefixed `imt_`, so nothing else is touched). Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**. It creates the database and loads sample data.
2. **Connect the app.** In Supabase go to **Project Settings → API** (or **Connect**) and copy the **Project URL** and the **anon / publishable key**. Paste them into `js/config.js` and commit.
3. **Vercel.** **Add New → Project → Import** this GitHub repo. Framework preset: **Other**. No build command. Click **Deploy**.
4. Open the Vercel link on a phone (vaccinator) and a laptop (supervisor).

## Demo accounts

| Role | Username | PIN |
|---|---|---|
| Vaccinator, Igando HC | `sbello` | `1234` |
| Vaccinator, Egbeda Model PHC | `rojo` | `1234` |
| Vaccinator, Ikotun-Egbe PHC | `ayusuf` / `fadeyemi` | `1234` |
| LGA Supervisor (Babajide Arulogun) | `supervisor` | `2026` |

Use test data only, never real children's records.

## What is simulated

SMS delivery (the message shows on screen; connect a gateway such as Termii for production), LASRA and birth-certificate lookups, and the live DHIS2 push (the app builds the real `dataValueSets` payload). Fingerprints are Phase 2.

## How the data is protected

- The browser cannot read or write any table directly. Every action is an `imt_*` database function that checks the sign-in token and role.
- Each dose record is sealed with a SHA-256 hash that includes the previous record's hash. A database trigger blocks every edit or delete unless it comes through a supervisor decision with a written reason, and every decision is kept in the audit trail.

## Automatic checks on every dose

GPS missing or more than 1 km from the planned site · no guardian OTP · no point-of-care face photo · batch belongs to another vaccine · batch expired · batch not in the vaccine box collected · batch stock exhausted · duplicate dose · previous dose missing · less than 28 days since previous dose · child below minimum age · a different child recorded within 45 seconds · guardian phone shared by 4+ children.

**When the box is returned:** vials unaccounted for · more doses recorded than opened vials hold · empty vials with no doses · wastage over 50% beyond one vial (possible vial dumping).
