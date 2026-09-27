# Find My Native Plants — Runbook

The operational reference for findmynativeplants.com.au. What it is, how the pieces
fit, and the exact steps to serve a customer. Keep this current.

## 1. What this is

A national "what grew here before 1750" tool. Enter any Australian address → read the
pre-European vegetation at that point from government datasets → offer the indigenous
planting list for that vegetation, captured by double opt-in and sent by hand (for now).
A Gardener & Son project; feeds the Ecological Registry.

## 2. Live system & where things live

- **Repo:** `tinyforests/my-native-plants` (public). **GitHub Pages serves `main` at
  findmynativeplants.com.au** — every push to `main` deploys in ~1–2 min. GitHub = live.
- **Local working copy:** `~/Projects/my-native-plants` ONLY. Never clone into the home dir.
- **Front end:** `index.html` + 8 state pages (`nsw/ vic/ qld/ wa/ sa/ tas/ nt/ act/`) +
  `privacy.html`, `confirmed/`, `unsubscribed/`. Shared `app.js` (resolver engine) + `styles.css`.
- **Email backend:** Google Apps Script project **"findmynativeplants"** (bound to the
  subscribers Sheet). Source of truth for the code is `apps-script/` in this repo — but the
  *deployed* copy is pasted into the Apps Script editor and must be kept in sync by hand.

## 3. The resolver (per-state data)

Routed by state (from Nominatim `addressdetails`) in `app.js`:

| State | Source | Resolution | Notes |
|---|---|---|---|
| NSW | SVTM 1750 PCT (identify) | community | Central NSW gap → falls to NVIS |
| QLD | Pre-clear Regional Ecosystems (query) | community | RE code = bioregion.landzone.veg; REDD species not yet bundled |
| WA  | Beard pre-European (query) | association | `flor_desc` carries dominant species |
| VIC | NVIS + handoff to findmyevc | community | EVC is the sharp answer |
| TAS | NVIS + present-day TASVEG context | subgroup | no pre-1750 layer exists |
| SA / NT / ACT / gaps | NVIS 7.0 pre-1750 MVS | subgroup | SA cached service is dead → NVIS |

All endpoints are CORS-clean from the browser. No proxy needed.

## 4. Double opt-in email capture (LIVE)

Flow: gate on site → POST to Apps Script (`CFG.optinEndpoint` in `app.js`) → **PENDING** row
+ confirmation email → subscriber clicks → **CONFIRMED** → redirected to `/confirmed/`.
Unsubscribe link in every send → **UNSUBSCRIBED** → `/unsubscribed/`.

- **Endpoint:** the `/exec` URL is in `app.js` → `CFG.optinEndpoint`.
- **Sheet:** ID is in `apps-script/Code.gs` → `CONFIG.SHEET_ID`, tab `subscribers`.
- **Columns:** `timestamp, email, status, token, address, state, system, code, name,
  consent, consentText, source, page, confirmedAt, unsubscribedAt, sentAt`.
- **Editing Code.gs:** if you change the web-app behaviour you must
  **Deploy → Manage deployments → edit → New version**. The `/exec` URL stays the same.
  Adding/running a non-web-app function (like a send) needs no redeploy — just Run it.

## 5. Sending a curated species list (the customer-serving loop)

This is manual and expert-reviewed on purpose — lists must be indigenous-only, and no
autonomous source can guarantee that yet (ALA occurrence data is ~20% weeds/exotics; its
native flag is "Not supplied" on ~99% of records). Steps:

1. **Find who's waiting:** in the `subscribers` sheet, rows with `status = CONFIRMED` and an
   empty `sentAt`.
2. **Ground-truth the flora** at their point (example query in `apps-script/` history):
   ALA biocache `occurrences/search?fq=kingdom:Plantae&fq=taxonRank:species&lat=&lon=&radius=2&facets=scientificName&fsort=count`.
   Use it as evidence, not gospel — filter out exotics/weeds and family/genus-only rows.
3. **Curate** a layered list (canopy → small trees → shrubs → climbers → groundcovers →
   sedges) of species genuinely indigenous to that community. Keep it true; when unsure, drop it.
4. **Send:** in the Apps Script project, call the generic sender in
   `apps-script/SendCuratedList.gs` with the customer's email, token, address and the veg
   object. It emails from the Gardener & Son account via `buildListEmail_`, includes the
   Registry CTA + one-click unsubscribe, and stamps `sentAt` so they're not re-sent.
5. **Never commit customer PII** (email, token, street address) into this public repo. Put
   real values only in the Apps Script editor (private) at send time.

## 6. Email rules (learned)

- **Dark text on a light background.** Gmail strips dark backgrounds — light text on a dark
  band can render invisible. Prefer white/beige panels with dark ink; keep dark bands minimal
  and never rely on them for legibility. (See `feedback_gs_email` memory.)
- Warm tone. No "first ever / look how new we are" boasting.
- Reference template to match: **`~/Projects/reg/emails/harrystreet-registered.html`**.
- Always: sender identity (Gardener & Son + studio address) + working unsubscribe (Spam Act).

## 7. Ecological Registry CTA

Every planting-list email carries a "Register your garden" CTA →
`https://ecologicalregistry.org/?utm_source=fmnp&utm_medium=email&utm_campaign=planting-list`.
Built into `buildListEmail_`, so all future sends inherit it. (Registry = `~/Projects/reg`.)

## 8. Open items / roadmap

- [ ] **Email template:** revise `buildListEmail_` to dark-text-on-light per §6 / harrystreet template.
- [ ] **From-address:** sends come from the script owner's Google account. Set a Gmail
      "Send mail as" Gardener & Son alias for a branded from-address.
- [ ] **QLD species:** bundle the REDD XLSX (CC-BY) → real QLD species lists.
- [ ] **Per-search logging:** `CFG.logEndpoint` still blank (email capture works; search demand isn't logged).
- [ ] **Automation:** a time-driven trigger could draft lists for CONFIRMED-unsent rows for
      one-click approval. Not autonomous send — integrity gate stays.
- [ ] **SEO:** submit `sitemap.xml` in Google Search Console once set up.
- [ ] `jurisdiction/` — modular resolver library preserved in the repo, not yet wired into the site.

## 9. Send log

- First curated send completed (WA Banksia–Jarrah woodland, Swan Coastal Plain). Details in
  the `subscribers` sheet — not recorded here (public repo, no customer PII).
