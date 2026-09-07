/* ============================================================
   CONFIG
   ============================================================ */
const CFG = {
  geocode: 'https://nominatim.openstreetmap.org/search',
  // Same column shape as the fmevc lookup sheet so the demand dashboard reads it unchanged.
  logEndpoint: '',  // ← paste the Apps Script /exec URL (optional; console-logs until set)
  // Double opt-in email capture. Post goes to the Apps Script web app (apps-script/Code.gs),
  // which stores a PENDING row and emails a confirmation link. Nobody is added until they click.
  optinEndpoint: 'https://script.google.com/macros/s/AKfycbwQAufeg1z8ivI7NK6gVvCkI8TYvKhutuCla01ILif2AHst6FFwp8lSLlKtsTjkG6t-/exec'
};

/* Live, CORS-verified endpoints (audited 5 Sep 2026, re-verified from browser origin). */
const EP = {
  nvis: 'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_pre_mvs/MapServer',
  nsw:  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_1750_PCT/MapServer',
  qld:  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Biota/VegetationManagement/MapServer/15',
  wa:   'https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Environment/MapServer/17',
  tas:  'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/NaturalEnvironment/MapServer/0'
};

/* Nominatim state string → code. Drives resolver tiering. */
const STATE_CODE = {
  'victoria':'VIC','new south wales':'NSW','queensland':'QLD',
  'western australia':'WA','south australia':'SA','tasmania':'TAS',
  'northern territory':'NT','australian capital territory':'ACT',
  'jervis bay territory':'ACT'
};

/* Queensland land zones — the middle number of an RE code (bioregion.landzone.veg).
   Gives a geologically honest character line before REDD descriptions are bundled. */
const QLD_LANDZONE = {
  '1':'Tidal flats and saline coastal lands — mangrove and saltmarsh country.',
  '2':'Coastal dunes and beach ridges — deep sands close to the sea.',
  '3':'Alluvial river and creek flats — the richest, most-cleared country in the region.',
  '4':'Cracking clay plains on Cainozoic sediments — grassland and open woodland.',
  '5':'Old loamy and sandy plains on remnant Cainozoic surfaces.',
  '6':'Cainozoic sand plains and dunes inland — low, sclerophyll-rich vegetation.',
  '7':'Lateritic duricrust — ironstone-capped rises with hardy heath and woodland.',
  '8':'Cainozoic igneous rocks, basalt — fertile red soils, historically well-treed.',
  '9':'Fine-grained sedimentary rocks — undulating woodland country.',
  '10':'Coarse sedimentary rocks — sandstone ranges and scarps.',
  '11':'Metamorphic rocks — hilly, mixed woodland and forest.',
  '12':'Granite and other igneous rocks — boulder country with distinctive flora.'
};

/* MVS / vegetation character lines — keyword matched against whatever name string
   the resolver returns. Content layer only; the classification always comes from the service. */
const CHARACTER = [
  [/rainforest|vine thicket/i, 'Closed canopy, deep shade, moisture held year round. Structure matters more than any single species here — layers, not specimens.'],
  [/mallee/i,                  'Multi-stemmed eucalypts from a lignotuber, low and wide, over a sparse understorey. Built for drought and fire, and for very little soil.'],
  [/hummock grassland|spinifex|triodia/i,'Spinifex rings over sand or stony ground, with scattered trees. Sparse by design, not by degradation.'],
  [/tussock grassland|grassland/i,'Open ground held by perennial tussocks, with lilies and daisies between them. The most cleared vegetation type in the country.'],
  [/chenopod|samphire|saltbush|bluebush/i,'Saltbush and bluebush over saline or alkaline soils. Silver-grey, low, and far tougher than it looks.'],
  [/heath/i,                   'Dense, hard-leaved, low shrubland on poor soils. Extraordinary flowering diversity in a very small vertical space.'],
  [/mangrove|tidal|saltmarsh/i,'Tidal, saline, and structurally simple above ground. The complexity is in the root systems.'],
  [/woodland/i,                'Trees spaced with crowns apart, over grass and scattered shrubs. Light reaches the ground — that ground layer is the point.'],
  [/open forest|tall.*forest|wet sclerophyll/i,'Eucalypt crowns touching or nearly so, over a shrub and ground layer that shifts with aspect and moisture.'],
  [/forest/i,                  'A eucalypt-dominated canopy with a distinct understorey beneath it. What you plant underneath is what makes it work.'],
  [/shrubland|acacia|scrub/i,  'Shrubs over open ground, often acacia-led. Nitrogen fixers doing the structural work.'],
  [/wetland|swamp|lignum|sedge|rush/i,'Seasonally or permanently wet, with sedges, rushes and water-tolerant shrubs. Wet and dry phases are both part of it.']
];
const characterFor = name => (CHARACTER.find(([re]) => re.test(name||'')) || [,
  'A distinct pre-1750 vegetation type with its own structure, soils and species set.'])[1];

/* ============================================================
   GEOCODE
   ============================================================ */
async function geocode(q){
  const url = `${CFG.geocode}?format=json&countrycodes=au&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers:{ 'Accept':'application/json' } });
  if(!r.ok) throw new Error('geocode');
  const j = await r.json();
  if(!j.length) throw new Error('notfound');
  const hit = j[0];
  const stateName = (hit.address && hit.address.state || '').toLowerCase();
  return { lat:+hit.lat, lng:+hit.lon, label:hit.display_name,
           state: STATE_CODE[stateName] || null };
}

/* Reverse geocode for the "use my location" button. */
async function reverse(lat,lng){
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`;
  const r = await fetch(url, { headers:{ 'Accept':'application/json' } });
  if(!r.ok) throw new Error('geocode');
  const j = await r.json();
  const stateName = (j.address && j.address.state || '').toLowerCase();
  return { lat, lng, label:j.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
           state: STATE_CODE[stateName] || null };
}

/* ============================================================
   ESRI HELPERS
   ============================================================ */
function attr(attrs, needle){
  const k = Object.keys(attrs||{}).find(k => k.toLowerCase().includes(needle));
  return k ? attrs[k] : null;
}

/* Raster identify against a MapServer (returns first result's attributes, or null). */
async function esriIdentify(baseUrl, lat, lng, layers){
  const d = 0.01;
  const p = new URLSearchParams({
    f:'json',
    geometry: JSON.stringify({ x:lng, y:lat, spatialReference:{ wkid:4326 } }),
    geometryType:'esriGeometryPoint', sr:'4326', layers,
    tolerance:'1', mapExtent:`${lng-d},${lat-d},${lng+d},${lat+d}`,
    imageDisplay:'400,400,96', returnGeometry:'false'
  });
  const r = await fetch(`${baseUrl}/identify?${p}`);
  if(!r.ok) throw new Error('service');
  const j = await r.json();
  return (j.results && j.results[0] && j.results[0].attributes) || null;
}

/* Vector query against a single MapServer layer (returns first feature's attributes, or null). */
async function esriQuery(layerUrl, lat, lng, outFields){
  const p = new URLSearchParams({
    f:'json',
    geometry: JSON.stringify({ x:lng, y:lat, spatialReference:{ wkid:4326 } }),
    geometryType:'esriGeometryPoint', inSR:'4326',
    spatialRel:'esriSpatialRelIntersects', outFields, returnGeometry:'false'
  });
  const r = await fetch(`${layerUrl}/query?${p}`);
  if(!r.ok) throw new Error('service');
  const j = await r.json();
  return (j.features && j.features[0] && j.features[0].attributes) || null;
}

/* ============================================================
   RESOLVER — every tier returns the shared schema:
   { system, code, name, character, detail?, species?, resolution,
     source, status, note?, context? }
   ============================================================ */
async function resolveNVIS(lat, lng, note){
  const a = await esriIdentify(EP.nvis, lat, lng, 'all:0');
  const base = { system:'MVS', resolution:'subgroup',
                 source:'NVIS 7.0 pre-1750 MVS (DCCEEW)', note };
  const pixel = a && attr(a, 'pixel value');
  // NVIS returns the literal string "NoData" for water and for gaps, in a populated results array.
  if(!a || pixel === null || String(pixel).trim().toLowerCase() === 'nodata'){
    return { ...base, code:null, name:null, character:null, status:'nodata' };
  }
  const name = attr(a,'mvs_name') || attr(a,'mvs name') || null;
  return { ...base, code:String(pixel).trim(), name,
           character: characterFor(name), status:'ok' };
}

async function resolveNSW(place){
  const a = await esriIdentify(EP.nsw, place.lat, place.lng, 'all:2');
  const pixel = a && attr(a,'pixel value');
  const name  = a && (a.PCTName || attr(a,'pctname'));
  // Central NSW pre-clearing coverage is still in progress — treat gaps as fall-through, not empty.
  if(!a || !name || String(pixel).trim().toLowerCase() === 'nodata'){
    return resolveNVIS(place.lat, place.lng,
      'This point sits outside the mapped SVTM 1750 pre-clearing coverage (Central NSW is still in progress), so the national layer is shown instead.');
  }
  const vegClass = a.vegClass || attr(a,'vegclass') || '';
  const vegForm  = a.vegForm  || attr(a,'vegform')  || '';
  return {
    system:'PCT', code:String(a.PCTID || pixel || '').trim(), name,
    character: characterFor(vegForm || vegClass || name),
    detail: [vegClass, vegForm].filter(Boolean).join(' · '),
    resolution:'community',
    source:'NSW SVTM 1750 PCT (DCCEEW NSW / BioNet)', status:'ok'
  };
}

async function resolveQLD(place){
  const a = await esriQuery(EP.qld, place.lat, place.lng, 're,re_label,re1');
  const re = a && (a.re || a.re_label || a.re1);
  if(!a || !re){
    return resolveNVIS(place.lat, place.lng,
      'No pre-clear regional ecosystem is mapped at this point, so the national layer is shown instead.');
  }
  const code = String(re).trim();
  const lz = code.split('.')[1];
  return {
    system:'RE', code, name:`Regional Ecosystem ${code}`,
    character: QLD_LANDZONE[lz] || characterFor(''),
    detail:'Pre-clearing regional ecosystem. The code reads bioregion · land zone · vegetation.',
    resolution:'community',
    source:'QLD Pre-clear Regional Ecosystems (Queensland Herbarium)',
    status:'ok', speciesPending:true
  };
}

async function resolveWA(place){
  const a = await esriQuery(EP.wa, place.lat, place.lng, 'veg_assoc,veg_type,flor_desc,struct_des');
  const flor = a && a.flor_desc;
  if(!a || !flor){
    return resolveNVIS(place.lat, place.lng,
      'This point sits outside Beard’s pre-European mapping, so the national layer is shown instead.');
  }
  const struct = (a.struct_des || '').trim();
  // Split the leading common-name phrase from the scientific-name list that follows.
  // The scientific list starts at the first genus (Capitalised) that is preceded by a
  // lowercase word — this survives common-name phrases that themselves start capitalised
  // ("Mainly jarrah and marri Eucalyptus marginata…" splits before "Eucalyptus").
  const m = flor.match(/[a-z]\s+([A-Z][a-z]+\s+[a-z])/);
  const cut = m ? m.index + m[0].indexOf(m[1]) : -1;
  const common  = cut > 0 ? flor.slice(0, cut).replace(/[\s,;.–-]+$/,'').trim() : '';
  const species = cut > 0 ? flor.slice(cut).trim() : flor.trim();
  return {
    system:'Beard association', code:String(a.veg_assoc || '').replace(/\.0$/,''),
    name: common || struct || 'Beard vegetation association',
    character: characterFor(struct || flor),
    detail: struct ? `Structural formation: ${struct}.` : '',
    species: species || null,
    resolution:'association',
    source:'WA Beard Pre-European Vegetation, 1:250,000 (Beard et al. 2013)',
    status:'ok'
  };
}

async function resolveTAS(place){
  // Tasmania has no pre-1750 layer — use NVIS for the classification,
  // and surface present-day TASVEG alongside it (honestly labelled).
  const res = await resolveNVIS(place.lat, place.lng);
  res.note = 'Tasmania has no pre-1750 map. The classification above is the national layer; what’s actually mapped on the ground today is shown below.';
  try{
    const a = await esriQuery(EP.tas, place.lat, place.lng, 'VEGCODE,VEGCODE_D,VEG_GROUP');
    if(a && (a.VEGCODE_D || a.VEGCODE)){
      res.context = { title:'Mapped there today (TASVEG 3.0)',
                      body:`${a.VEGCODE_D || a.VEGCODE}${a.VEG_GROUP ? ' — ' + a.VEG_GROUP : ''}.` };
    }
  }catch(e){ /* TASVEG optional; NVIS answer already stands */ }
  return res;
}

async function resolve(place){
  switch(place.state){
    case 'NSW': return resolveNSW(place);
    case 'QLD': return resolveQLD(place);
    case 'WA':  return resolveWA(place);
    case 'TAS': return resolveTAS(place);
    // VIC resolves on the national layer here, then hands off to findmyevc for the sharp answer.
    default:    return resolveNVIS(place.lat, place.lng);
  }
}

/* fire-and-forget, same columns as the fmevc sheet */
function log(row){
  if(!CFG.logEndpoint){ console.log('[lookup]', row); return; }
  fetch(CFG.logEndpoint, { method:'POST', mode:'no-cors',
    headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(row) }).catch(()=>{});
}

/* ============================================================
   VIEW
   ============================================================ */
const $ = s => document.querySelector(s);
const out = $('#results'), btn = $('#go'), input = $('#addr'), locBtn = $('#locate');
const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function show(html){ out.innerHTML = html; out.hidden = false; out.scrollIntoView({block:'start'}); }

function renderState(title, body){
  show(`<section class="state"><h3>${title}</h3><p>${body}</p></section>`);
}

function renderResult(place, res){
  const vic = place.state === 'VIC';

  const handoff = vic ? `
    <section class="handoff">
      <h3>Victoria is mapped in far more detail</h3>
      <p>Here the vegetation is classified as an Ecological Vegetation Class — hundreds of types with
         species lists, instead of the national subgroups shown above. Same address, a much sharper answer.</p>
      <a href="https://findmyevc.com/?q=${encodeURIComponent(place.label)}">Look this address up on findmyevc →</a>
    </section>` : '';

  const context = res.context ? `
    <section class="context">
      <span>PRESENT DAY</span>
      <h3>${esc(res.context.title)}</h3>
      <p>${esc(res.context.body)}</p>
    </section>` : '';

  const gate = res.status === 'ok' ? `
    <section class="gate">
      <h3>The species list for this vegetation</h3>
      <p>We’re building indigenous planting lists community by community, starting with the ones people ask for most.
         Leave your email and yours arrives the week it’s finished.</p>
      <form id="gateForm">
        <input id="gateEmail" type="email" required placeholder="you@example.com" aria-label="Email address">
        <button type="submit">Send it to me</button>
      </form>
      <label class="consent">
        <input type="checkbox" id="gateConsent" required>
        <span>Yes, email me the planting list for this vegetation and occasional native-planting notes
          from Gardener &amp; Son. I can unsubscribe anytime. See our
          <a href="/privacy.html">privacy&nbsp;policy</a>.</span>
      </label>
      <p class="done" id="gateDone" hidden>
        <strong>Almost there — check your inbox.</strong> We’ve sent a confirmation link to that address.
        Click it and you’re on the list. (No confirmation, no emails — that’s how double opt-in works.)
      </p>
    </section>` : '';

  if(res.status === 'nodata'){
    show(`
      <section class="card">
        <p class="eyebrow">NO PRE-1750 VEGETATION MAPPED</p>
        <p class="addr">${esc(place.label)}</p>
        <h2 class="vegname">Water, or outside the mapped extent</h2>
        <p class="character">The national dataset returns nothing for this point. That usually means open water,
           or a gap in coverage. Try a nearby street address on land.</p>
        ${res.note ? `<p class="detail">${esc(res.note)}</p>` : ''}
        <div class="meta">
          <div><span>STATUS</span><strong>nodata</strong></div>
          <div><span>SOURCE</span><strong>NVIS 7.0 pre-1750</strong></div>
        </div>
      </section>${handoff}`);
    return;
  }

  const species = res.species ? `
    <div class="species">
      <span>DOMINANT SPECIES (FROM THE MAPPING)</span>
      <p><i>${esc(res.species)}</i></p>
    </div>` : (res.speciesPending ? `
    <div class="species">
      <span>SPECIES</span>
      <p>A full species-bearing description for this regional ecosystem is held in Queensland’s
         REDD database and is being folded in. Leave your email below to get it.</p>
    </div>` : '');

  show(`
    <section class="card">
      <p class="eyebrow">BEFORE 1750, THIS ADDRESS STOOD IN</p>
      <p class="addr">${esc(place.label)}</p>
      <h2 class="vegname">${esc(res.name || (res.system + ' ' + res.code))}</h2>
      ${res.character ? `<p class="character">${esc(res.character)}</p>` : ''}
      ${res.detail ? `<p class="detail">${esc(res.detail)}</p>` : ''}
      ${species}
      ${res.note ? `<p class="detail">${esc(res.note)}</p>` : ''}
      <div class="meta">
        <div><span>SYSTEM</span><strong>${esc(res.system)}</strong></div>
        <div><span>CODE</span><strong>${esc(res.code || '—')}</strong></div>
        <div><span>RESOLUTION</span><strong>${esc(res.resolution)}</strong></div>
        <div><span>SOURCE</span><strong>${esc((res.source||'').split('(')[0].trim())}</strong></div>
      </div>
    </section>
    ${context}
    ${handoff}
    ${gate}`);

  const form = $('#gateForm');
  if(form) form.addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#gateEmail').value.trim();
    const consent = $('#gateConsent');
    if(!email) return;
    if(consent && !consent.checked){ consent.focus(); return; }
    // Consent metadata is captured with the signup so the record is defensible under the Spam Act.
    const payload = {
      action:'subscribe', email,
      address:place.label, state:place.state || 'AU',
      system:res.system, code:res.code, name:res.name || '',
      consent:true, consentText:'planting list + occasional native-planting notes',
      source:'fmnp', page:location.pathname, ts:new Date().toISOString()
    };
    if(CFG.optinEndpoint){
      const fd = new URLSearchParams();
      Object.entries(payload).forEach(([k,v]) => fd.append(k, v));
      fetch(CFG.optinEndpoint, { method:'POST', mode:'no-cors',
        headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:fd.toString() }).catch(()=>{});
    } else {
      console.log('[optin:subscribe]', payload);
    }
    form.hidden = true;
    const c = document.querySelector('.gate .consent'); if(c) c.hidden = true;
    $('#gateDone').hidden = false;
  });
}

async function runWith(place){
  renderState('<span class="spinner"></span>Reading the vegetation',
    `Reading the pre-1750 vegetation layer beneath ${esc(place.label)}.`);
  const res = await resolve(place);
  log({ timestamp:new Date().toISOString(), address:place.label, lat:place.lat, lng:place.lng,
        state:place.state, system:res.system, code:res.code, name:res.name,
        resolution:res.resolution, status:res.status, site:'fmnp', referral:document.referrer||'' });
  renderResult(place, res);
}

async function run(){
  const q = input.value.trim();
  if(!q){ input.focus(); return; }
  btn.disabled = true;
  renderState('<span class="spinner"></span>Looking it up', 'Finding the address, then reading the pre-1750 vegetation layer beneath it.');
  try{
    const place = await geocode(q);
    await runWith(place);
  }catch(err){ renderError(err); }
  finally{ btn.disabled = false; }
}

function renderError(err){
  if(err.message === 'notfound'){
    renderState('That address didn’t match', 'Try adding the suburb and state, or use a nearby street address.');
  }else if(err.message === 'geocode'){
    renderState('The address lookup is unavailable', 'The geocoding service didn’t respond. Wait a moment and search again.');
  }else{
    renderState('The vegetation layer didn’t respond', 'That state’s dataset is served by a government host and is occasionally offline. Search again shortly.');
  }
}

if(btn) btn.addEventListener('click', run);
if(input) input.addEventListener('keydown', e => { if(e.key === 'Enter') run(); });

if(locBtn) locBtn.addEventListener('click', () => {
  if(!navigator.geolocation){ renderState('Location isn’t available', 'Your browser didn’t offer a location. Type an address instead.'); return; }
  locBtn.disabled = true;
  renderState('<span class="spinner"></span>Finding you', 'Reading your location, then the vegetation beneath it.');
  navigator.geolocation.getCurrentPosition(async pos => {
    try{
      const place = await reverse(pos.coords.latitude, pos.coords.longitude);
      await runWith(place);
    }catch(err){ renderError(err); }
    finally{ locBtn.disabled = false; }
  }, () => {
    locBtn.disabled = false;
    renderState('Couldn’t read your location', 'Permission was declined or timed out. Type an address instead.');
  }, { enableHighAccuracy:true, timeout:10000 });
});

/* Deep-link support: ?q=address runs a lookup on load. */
(function(){
  if(!input) return;
  const q = new URLSearchParams(location.search).get('q');
  if(q){ input.value = q; run(); }
})();

/* PWA */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}
