# Find My Native Plants — Runbook

The operational reference for findmynativeplants.com.au. What it is, how the pieces
fit, and the exact steps to serve a customer. Keep this current.

## 1. What this is

A national "what grew here before 1750" tool. Enter any Australian address → read the
pre-European vegetation at that point from government datasets → offer the indigenous
planting list for that vegetation, captured by double opt-in and served from curated,
human-reviewed lists (one per vegetation community — see §5).
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

## 5. Serving planting lists (automated, review-gated)

Lists are curated **once per vegetation community** and live in `lists/<SYSTEM>-<CODE>.json`
(public, no PII), served from the live site. `apps-script/Fulfil.gs` serves subscribers from them:

- **On confirm** (instant, via `doGet`) and every **15 min** (`processQueue` trigger), each
  `CONFIRMED` row with no `sentAt`/`draftedAt` is looked up by `system` + `code`:
  - list exists, `"reviewed": true` → **sent automatically**, `sentAt` stamped.
  - list exists, `"reviewed": false` → **Gmail draft** created for checking, `draftedAt`
    stamped, notice to `FULFIL.ADMIN`.
  - no list → `needsListAt` stamped, **one alert per community** to `FULFIL.ADMIN`. Adding the
    list later serves everyone waiting on the next queue run.
- Resubmits by the same person for the same community are stamped together — one list each.
- `FULFIL.AUTO_SEND_REVIEWED = false` turns auto-send off (everything becomes a draft).

**Adding a community:** copy an existing `lists/*.json`, keep the shape
(`system, code, reviewed, vegTitle, vegSub, intro, sources, layers[{layer, note, plants[[sci, common]]}]`).
Key = `system` + `-` + `code`, spaces → `-` (e.g. `Beard-association-1001`, `RE-12.5.3`, `PCT-3433`).
Curate indigenous-only: ground-truth with ALA biocache
(`occurrences/search?fq=kingdom:Plantae&fq=taxonRank:species&lat=&lon=&radius=2&facets=scientificName&fsort=count`)
as evidence, not gospel; the state source (REDD / BioNet / Beard) as the spine. When unsure, drop it.
Set `"reviewed": true` only once a human has checked it. Push to `main` → live in ~2 min.

**Never commit customer PII** (email, token, street address) to this public repo.

**One-time setup after merging:** paste `Code.gs` + `Fulfil.gs` into the Apps Script project
(delete `SendHarry.gs` there), Run `installTrigger` (approve the Gmail scope), then
Deploy → Manage deployments → edit → New version.

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

- [x] **Email template:** `buildListEmail_` is now dark-text-on-light throughout.
- [ ] **From-address:** sends come from the script owner's Google account. Set a Gmail
      "Send mail as" Gardener & Son alias for a branded from-address.
- [ ] **QLD species:** bundle the REDD XLSX (CC-BY) → real QLD species lists.
- [ ] **Per-search logging:** `CFG.logEndpoint` still blank (email capture works; search demand isn't logged).
- [x] **Automation:** `Fulfil.gs` — reviewed lists auto-send; unreviewed draft; missing alert.
- [ ] **Coverage:** every new community still needs one curated list. QLD REDD bundle and NSW
      BioNet PCT species could pre-fill drafts (still reviewed before `reviewed: true`).
- [ ] **SEO:** submit `sitemap.xml` in Google Search Console once set up.
- [ ] `jurisdiction/` — modular resolver library preserved in the repo, not yet wired into the site.

## 9. Send log

- First curated send completed (WA Banksia–Jarrah woodland, Swan Coastal Plain). Details in
  the `subscribers` sheet — not recorded here (public repo, no customer PII).
