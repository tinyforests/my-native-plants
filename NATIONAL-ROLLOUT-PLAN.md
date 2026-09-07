# Find My Native Plants — National pre-1750 rollout plan

**Goal:** turn findmynativeplants.com.au from a VIC-only EVC→plants tool into a
national **pre-European-vegetation → indigenous-plants** resolver — a client-side
static PWA (CORS confirmed for all vegetation endpoints), **reusing the Ecological
Registry's `jurisdiction/` engine** as the shared resolver.

Companion reference: `jurisdiction/PRE-1750-ENDPOINTS.md` (per-jurisdiction
endpoint audit, 5 Sep 2026).

---

## A. Engine strategy — reuse reg's `jurisdiction/`

`jurisdiction/` is a self-contained ESM module with **zero reg dependencies**
(it never imports the scoring engine). So:

- **Vendor it** into `my-native-plants/jurisdiction/`, kept byte-identical to
  reg's copy.
- Treat it as the **shared G&S core**. Engine changes land in reg's
  `jurisdiction/` (where the proof lives) and sync across. Promote to a shared
  package/CDN once stable in both apps.
- One schema everywhere: `{ system, code, name, resolution, source, status }`.

## B. Engine work (in `jurisdiction/`, benefits reg too)

| Item | State | Action |
|---|---|---|
| Resolver (ABS state) | returns "no match" for a clear Sydney point | **Fix first** — state detection + VIC handoff depend on it |
| VIC adapter | nv1750 (done) | reuse; findmynativeplants **hands VIC off to findmyevc** rather than resolving EVC inline |
| NVIS + IBRA national | wired | national answer everywhere + comparison |
| NSW adapter | exists, disabled, fields inferred | enable + capture live fields; SVTM 1750 PCT; Central-NSW gap → NVIS |
| QLD adapter | new | pre-clear RE (vector query, layer 15) |
| WA adapter | new | Beard pre-euro (raster identify, 1:250k → `association`) |
| SA adapter | new | pre-euro cached svc (verify identify; ag-region only → NVIS) |
| TAS | — | NVIS classification + TASVEG as present-day context |
| NT / ACT / else | wired | NVIS pre-1750 MVS |

## C. Species layer (the harder half)

- **VIC:** keep `curated-plants.json` (G&S-curated) — surfaced via findmyevc handoff.
- **QLD:** bundle REDD v13.1 (CC-BY static XLSX→JSON, keyed on RE code).
- **NSW:** BioNet OData (PCT→species) — confirm endpoint + CORS, then cache.
- **WA/SA/TAS:** descriptions only → classification + gated list + ALA fallback.
- **National fallback:** ALA biocache, filtered to indigenous/herbarium, framed
  as "recorded nearby," never a benchmark list.

## D. App / UI

- Front end: the new national `index.html` (NVIS everywhere + VIC handoff + a
  species-gate email capture).
- Resolver wired to `jurisdiction/`: `resolveJurisdiction()` for state (replaces
  the crude Victorian bounding box) and the national adapter for NVIS.
- Card is honest about precision: `community` (VIC/NSW/QLD) vs `association`
  (WA/SA) vs `subgroup` (NVIS).

## E. Phased delivery (each shippable)

0. **Vendor engine + fix ABS resolver + ship the national NVIS page** (VIC handoff).
1. **NSW** veg (SVTM 1750) + species (BioNet). Biggest population.
2. **QLD** veg (pre-clear RE) + REDD species bundle.
3. **WA / SA / TAS** classification (NVIS-backed), honest labels.
4. **ALA species fallback** + gated list wherever data is thin.

Each phase gated by a **live field-capture** (NSW/WA fields are inferred, not
observed) and a per-state smoke test.

## F. Risks

CORS OK for all veg endpoints (client-side viable) · NSW BioNet species URL
unconfirmed · inferred field names → capture before trusting · SA cached service
may not `identify` · Central-NSW coverage gap → NVIS · species divergence
(ALA "recorded nearby" ≠ "belongs here").
