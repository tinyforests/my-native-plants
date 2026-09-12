/**
 * One-off curated planting-list send — first customer (Harry, WA Banksia–Jarrah woodland).
 * Paste this file into the SAME Apps Script project as Code.gs (it reuses CONFIG, sheet_(),
 * findRowByToken_ and unsubscribeUrl from there), then select `sendHarryList` and click Run.
 *
 * It emails the curated list from the Gardener & Son account, advertises the Ecological Registry
 * with a "Register your garden" CTA, includes a working unsubscribe, and stamps a `sentAt`
 * timestamp on Harry's row so he isn't re-sent.
 *
 * buildListEmail_() + the LAYERS structure are deliberately generic — the seed of the eventual
 * automated sender. The registry CTA lives in the builder, so every future send carries it too.
 */

function sendHarryList() {
  var email = 'harryhatesprawns@gmail.com';
  var token = 'd3d33d29-9927-4030-915a-42a3ec1436e4';

  var meta = {
    address: 'Norseman Street, East Victoria Park, Perth WA 6101',
    vegTitle: 'Banksia–Jarrah Woodland',
    vegSub: 'Beard “Jarrah, banksia or casuarina” association · Swan Coastal Plain, Bassendean sands',
    intro: 'Before 1750 your address stood in low open woodland of Jarrah and Marri over Banksia, ' +
           'on the deep grey Bassendean sands of the Swan Coastal Plain. It is fire-adapted, ' +
           'nutrient-poor country with an extraordinarily rich understorey — the plants below are ' +
           'indigenous to this exact community and grouped by the layer they fill. Plant the canopy ' +
           'first; the wildflowers and sedges belong in the light and leaf-litter beneath it.'
  };

  var html = buildListEmail_(meta, HARRY_LAYERS, token);
  var subject = 'Your indigenous planting list — Banksia–Jarrah woodland, East Victoria Park';

  MailApp.sendEmail({
    to: email, subject: subject, htmlBody: html,
    body: 'Your indigenous planting list for Banksia–Jarrah woodland (Swan Coastal Plain). ' +
          'View this email in an HTML-capable client. Register your garden: https://ecologicalregistry.org  ' +
          'Unsubscribe: ' + unsubscribeUrl(token),
    name: CONFIG.FROM_NAME
  });

  var sh = sheet_();
  var row = findRowByToken_(sh, token);
  if (row > 0) {
    var sentCol = ensureColumn_(sh, 'sentAt');
    sh.getRange(row, sentCol).setValue(new Date());
  }
  Logger.log('Sent curated list to ' + email);
}

var HARRY_LAYERS = [
  { layer: 'Canopy trees', note: 'The framework — plant these first.',
    plants: [
      ['Eucalyptus marginata', 'Jarrah'],
      ['Corymbia calophylla', 'Marri'],
      ['Banksia attenuata', 'Slender Banksia'],
      ['Banksia menziesii', 'Firewood Banksia'],
      ['Allocasuarina fraseriana', 'Common Sheoak'],
      ['Nuytsia floribunda', 'WA Christmas Tree']
    ]},
  { layer: 'Small trees & tall shrubs', note: '',
    plants: [
      ['Banksia ilicifolia', 'Holly-leaved Banksia'],
      ['Banksia grandis', 'Bull Banksia'],
      ['Banksia sessilis', 'Parrotbush'],
      ['Allocasuarina humilis', 'Dwarf Sheoak'],
      ['Jacksonia sternbergiana', 'Green Stinkwood'],
      ['Adenanthos cygnorum', 'Woollybush'],
      ['Macrozamia riedlei', 'Zamia'],
      ['Xanthorrhoea preissii', 'Balga / Grasstree']
    ]},
  { layer: 'Shrubs', note: '',
    plants: [
      ['Acacia pulchella', 'Prickly Moses'],
      ['Acacia stenoptera', 'Narrow-winged Wattle'],
      ['Calothamnus quadrifidus', 'One-sided Bottlebrush'],
      ['Calothamnus sanguineus', 'Silky-leaved Blood-flower'],
      ['Hypocalymma robustum', 'Swan River Myrtle'],
      ['Hibbertia hypericoides', 'Yellow Buttercups'],
      ['Daviesia divaricata', 'Marno'],
      ['Bossiaea eriocarpa', 'Common Brown Pea'],
      ['Gompholobium tomentosum', 'Hairy Yellow Pea'],
      ['Petrophile linearis', 'Pixie Mops'],
      ['Stirlingia latifolia', 'Blueboy'],
      ['Hovea trisperma', 'Common Hovea'],
      ['Scaevola canescens', 'Grey Fanflower']
    ]},
  { layer: 'Climbers', note: '',
    plants: [
      ['Hardenbergia comptoniana', 'Native Wisteria'],
      ['Kennedia prostrata', 'Running Postman']
    ]},
  { layer: 'Groundcovers, herbs & wildflowers', note: '',
    plants: [
      ['Anigozanthos manglesii', 'Red-and-green Kangaroo Paw'],
      ['Conostylis aculeata', 'Prickly Conostylis'],
      ['Conostylis juncea', 'Rush Conostylis'],
      ['Dampiera linearis', 'Common Dampiera'],
      ['Patersonia occidentalis', 'Purple Flag'],
      ['Calectasia narragara', 'Blue Tinsel Lily'],
      ['Burchardia congesta', 'Milkmaids'],
      ['Dasypogon bromeliifolius', 'Pineapple Bush'],
      ['Philotheca spicata', 'Pepper-and-salt'],
      ['Hybanthus calycinus', 'Wild Violet']
    ]},
  { layer: 'Sedges, rushes & grasses', note: 'The ground layer that ties it together.',
    plants: [
      ['Lyginia imberbis', 'native rush'],
      ['Mesomelaena pseudostygia', 'Semaphore Sedge'],
      ['Desmocladus flexuosus', 'Chain Rush'],
      ['Lepidosperma squamatum', 'Sword-sedge']
    ]}
];

/** Generic branded planting-list email builder (the automation seed). */
function buildListEmail_(meta, layers, token) {
  var green = '#3d4535', beige = '#fff0dc', signal = '#7C9A52', brass = '#B49A63', ink = '#2b3126';
  var unsub = unsubscribeUrl(token);
  var registry = 'https://ecologicalregistry.org/?utm_source=fmnp&utm_medium=email&utm_campaign=planting-list';

  var sections = layers.map(function (L) {
    var items = L.plants.map(function (p) {
      return '<tr><td style="padding:4px 0;color:' + ink + ';font-size:15px;line-height:1.5">' +
             '<i>' + esc_(p[0]) + '</i>' +
             (p[1] ? ' <span style="color:' + green + ';opacity:.7">— ' + esc_(p[1]) + '</span>' : '') +
             '</td></tr>';
    }).join('');
    return '<tr><td style="padding:22px 0 4px">' +
             '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:18px;color:' + green + ';font-weight:bold">' + esc_(L.layer) + '</div>' +
             (L.note ? '<div style="font-size:13px;color:' + brass + ';margin:2px 0 6px">' + esc_(L.note) + '</div>' : '') +
           '</td></tr>' +
           '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + items + '</table></td></tr>';
  }).join('');

  return '' +
  '<div style="background:' + beige + ';padding:0;margin:0">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + beige + '">' +
  '<tr><td align="center" style="padding:32px 16px">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +

    '<tr><td style="background:' + green + ';color:' + beige + ';padding:14px 20px;font-family:monospace;font-size:12px;letter-spacing:2px">' +
      'FIND MY NATIVE PLANTS · A GARDENER &amp; SON PROJECT</td></tr>' +

    '<tr><td style="background:#ffffff;padding:34px 30px 8px">' +
      '<div style="font-family:monospace;font-size:11px;letter-spacing:1px;color:' + green + ';opacity:.6">BEFORE 1750, YOUR ADDRESS STOOD IN</div>' +
      '<div style="font-family:Georgia,serif;font-size:30px;line-height:1.1;color:' + green + ';margin:8px 0 4px">' + esc_(meta.vegTitle) + '</div>' +
      '<div style="font-size:13px;color:' + brass + '">' + esc_(meta.vegSub) + '</div>' +
      '<div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:' + green + ';margin-top:10px">' + esc_(meta.address) + '</div>' +
      '<p style="font-size:15px;line-height:1.7;color:' + ink + ';margin:18px 0 0">' + esc_(meta.intro) + '</p>' +
    '</td></tr>' +

    '<tr><td style="background:#ffffff;padding:6px 30px 30px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + sections + '</table>' +
      '<div style="border-top:1px solid ' + brass + ';margin-top:26px;padding-top:16px;font-size:13px;line-height:1.6;color:' + ink + '">' +
        'These are indigenous to your vegetation community, grown from local seed where possible. ' +
        'Ask your local indigenous nursery for provenance stock — at ' +
        '<a href="https://gardenerandson.com" style="color:' + green + '">Gardener &amp; Son</a> we can help.' +
      '</div>' +
    '</td></tr>' +

    // --- Ecological Registry CTA (carried on every send) ---
    '<tr><td style="background:' + signal + ';padding:26px 30px">' +
      '<div style="font-family:Georgia,serif;font-size:20px;color:#20261a;line-height:1.2">Put your garden on the map.</div>' +
      '<p style="font-size:14px;line-height:1.6;color:#20261a;margin:8px 0 16px">' +
        'When you plant back into this community, register your garden on the Ecological Registry — ' +
        'a public record of the native habitat being rebuilt, garden by garden, across Australia.</p>' +
      '<a href="' + registry + '" style="display:inline-block;background:' + green + ';color:' + beige + ';' +
        'padding:12px 22px;text-decoration:none;font-family:monospace;font-size:14px;letter-spacing:1px">REGISTER YOUR GARDEN &rarr;</a>' +
    '</td></tr>' +

    '<tr><td style="background:' + green + ';color:' + beige + ';padding:22px 30px;font-size:12px;line-height:1.7">' +
      '<strong>Gardener &amp; Son</strong><br>2 Churchill Street, Mont Albert VIC 3127<br>' +
      '<a href="https://findmynativeplants.com.au" style="color:' + signal + '">findmynativeplants.com.au</a>' +
      '<div style="margin-top:12px;font-size:11px;color:rgba(255,240,220,.6)">' +
        'You asked us for this planting list at findmynativeplants.com.au and confirmed your email. ' +
        'Prefer not to hear from us? <a href="' + unsub + '" style="color:' + signal + '">Unsubscribe instantly</a>.' +
      '</div>' +
    '</td></tr>' +

  '</table></td></tr></table></div>';
}

function ensureColumn_(sh, name) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = head.indexOf(name);
  if (idx >= 0) return idx + 1;
  var col = sh.getLastColumn() + 1;
  sh.getRange(1, col).setValue(name);
  return col;
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
