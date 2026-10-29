/**
 * Find My Native Plants — planting-list fulfilment
 * ---------------------------------------------------------------------------
 * Paste into the SAME Apps Script project as Code.gs (it reuses CONFIG, sheet_(),
 * findRowByToken_ and unsubscribeUrl). Replaces the one-off SendHarry.gs.
 *
 * How a confirmed subscriber gets their list:
 *   1. They click Confirm  -> Code.gs doGet calls fulfil_(row) straight away.
 *   2. Belt and braces: processQueue() runs every 15 min and picks up anyone
 *      CONFIRMED and not yet served (e.g. if the instant attempt failed).
 *
 * fulfil_ looks up a curated list for the subscriber's vegetation community at
 *   https://findmynativeplants.com.au/lists/<SYSTEM>-<CODE>.json   (lists/ in the repo)
 * and then:
 *   - list exists, "reviewed": true   -> SENDS it automatically, stamps sentAt.
 *   - list exists, "reviewed": false  -> creates a Gmail DRAFT for Tyson to check and
 *                                        send, stamps draftedAt, emails ADMIN.
 *   - no list yet                     -> stamps needsListAt, emails ADMIN once per
 *                                        community. When the list is later added to
 *                                        lists/, the next queue run serves everyone
 *                                        waiting on it.
 *
 * The integrity gate stays: nothing reaches a subscriber unless a human has marked that
 * community's list reviewed (or sends the draft themselves). The cost of curation is now
 * once per vegetation community, not once per person.
 *
 * SETUP (once): paste, Save, select installTrigger, Run, approve the Gmail scope.
 * Then redeploy the web app (Deploy > Manage deployments > edit > New version) so the
 * instant-on-confirm hook in Code.gs goes live.
 */

var FULFIL = {
  LIST_BASE: 'https://findmynativeplants.com.au/lists/',
  ADMIN: 'tyson@gardenerandson.com',
  AUTO_SEND_REVIEWED: true   // false = draft everything, even reviewed lists
};

/** One-time: install the 15-minute queue trigger (safe to re-run). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(15).create();
  Logger.log('processQueue trigger installed (every 15 min).');
}

/** Time-driven: serve every CONFIRMED row that hasn't been sent or drafted. */
function processQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = sheet_();
    var col = cols_(sh);
    var data = sh.getDataRange().getValues();
    var alerted = {};
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (r[col.status - 1] !== 'CONFIRMED') continue;
      if (r[col.sentAt - 1] || r[col.draftedAt - 1]) continue;
      fulfilRow_(sh, col, i + 1, alerted);
      data = sh.getDataRange().getValues(); // stamps may have touched sibling rows
    }
  } finally {
    lock.releaseLock();
  }
}

/** Called from Code.gs doGet straight after a confirm. Never throws. */
function fulfil_(row) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'busy'; // the queue will pick it up
  try {
    var sh = sheet_();
    return fulfilRow_(sh, cols_(sh), row, {});
  } catch (err) {
    Logger.log('fulfil_ failed for row ' + row + ': ' + err);
    return 'error';
  } finally {
    lock.releaseLock();
  }
}

function fulfilRow_(sh, col, row, alerted) {
  var v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var sub = {
    email: v[col.email - 1], token: v[col.token - 1], address: v[col.address - 1],
    state: v[col.state - 1], system: v[col.system - 1], code: String(v[col.code - 1]),
    name: v[col.name - 1], needsListAt: v[col.needsListAt - 1]
  };
  if (v[col.status - 1] !== 'CONFIRMED') return 'skip';
  if (v[col.sentAt - 1] || v[col.draftedAt - 1]) return 'done';  // re-clicked confirm, etc.
  if (!sub.email || !sub.token || !sub.code) return 'skip';
  if (String(v[col.page - 1]) === '/backend-test') return 'skip';

  // Mixed polygons come through as "12.1.1/12.3.6" (dominant first). Prefer a list curated for
  // the exact mix; otherwise fall back to the dominant community's list.
  var key = listKey_(sub.system, sub.code);
  var list = fetchList_(key);
  var parts = sub.code.split('/');
  if (!list && parts.length > 1) list = fetchList_(listKey_(sub.system, parts[0]));

  if (!list) {
    if (!sub.needsListAt) {
      stampSiblings_(sh, col, sub, 'needsListAt');
      if (!alerted[key]) { notifyNeedsList_(sub, key); alerted[key] = true; }
    }
    return 'needs-list';
  }

  // Lists sent by hand before automation (or by a previous run that failed to stamp) live in
  // Sent mail, not the sheet. Check there so nobody gets the same list twice.
  if (sentBefore_(sub.email, list.vegTitle)) {
    stampSiblings_(sh, col, sub, 'sentAt');
    return 'already-sent';
  }

  var mail = composeList_(list, sub);
  if (list.reviewed && FULFIL.AUTO_SEND_REVIEWED) {
    sendAsGS_(sub.email, mail.subject, mail.text, { htmlBody: mail.html });
    stampSiblings_(sh, col, sub, 'sentAt');
    return 'sent';
  }

  GmailApp.createDraft(sub.email, mail.subject, mail.text, gsOpts_({ htmlBody: mail.html }));
  stampSiblings_(sh, col, sub, 'draftedAt');
  notifyDraft_(sub, key, mail.subject);
  return 'drafted';
}

/* ---------- lists ---------- */

function listKey_(system, code) {
  return (String(system) + '-' + String(code)).trim()
    .replace(/[\s\/]+/g, '-').replace(/[^A-Za-z0-9.\-]/g, '');
}

function fetchList_(key) {
  var url = FULFIL.LIST_BASE + encodeURIComponent(key) + '.json?v=' + Date.now();
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;
  try {
    var list = JSON.parse(res.getContentText());
    return (list && list.layers && list.layers.length) ? list : null;
  } catch (e) {
    return null;
  }
}

function sentBefore_(email, vegTitle) {
  var words = String(vegTitle || '').split(/[^A-Za-z]+/).filter(function (w) { return w.length > 3; });
  var q = 'in:sent to:' + email + ' subject:"indigenous planting list"' +
          words.map(function (w) { return ' subject:' + w; }).join('');
  return GmailApp.search(q, 0, 1).length > 0;
}

/* ---------- sheet helpers ---------- */

function cols_(sh) {
  var need = ['timestamp','email','status','token','address','state','system','code','name','page',
              'confirmedAt','unsubscribedAt','sentAt','draftedAt','needsListAt'];
  var out = {};
  need.forEach(function (n) { out[n] = ensureColumn_(sh, n); });
  return out;
}

/** Stamp this person's every row for the same community, so resubmits aren't re-served. */
function stampSiblings_(sh, col, sub, field) {
  var data = sh.getDataRange().getValues();
  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[col.email - 1]).toLowerCase() === String(sub.email).toLowerCase() &&
        String(r[col.system - 1]) === String(sub.system) &&
        String(r[col.code - 1]) === String(sub.code) &&
        !r[col[field] - 1]) {
      sh.getRange(i + 1, col[field]).setValue(now);
    }
  }
}

function ensureColumn_(sh, name) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = head.indexOf(name);
  if (idx >= 0) return idx + 1;
  var c = lastCol + 1;
  sh.getRange(1, c).setValue(name);
  return c;
}

/* ---------- admin notices ---------- */

function notifyNeedsList_(sub, key) {
  var lookup = {
    RE: 'https://apps.des.qld.gov.au/regional-ecosystems/details/?re=' + encodeURIComponent(sub.code),
    PCT: 'https://vegetation.bionet.nsw.gov.au/'
  }[sub.system] || '';
  sendAsGS_(FULFIL.ADMIN, 'FMNP: list needed — ' + sub.system + ' ' + sub.code + (sub.state ? ' (' + sub.state + ')' : ''),
      'A confirmed subscriber is waiting on a planting list we don\'t have yet.\n\n' +
      'Community: ' + sub.system + ' ' + sub.code + (sub.name ? ' — ' + sub.name : '') + '\n' +
      'Address:   ' + (sub.address || '(none)') + '\n' +
      (lookup ? 'Reference: ' + lookup + '\n' : '') +
      '\nAdd lists/' + key + '.json to the repo (copy an existing list for the shape).\n' +
      'Set "reviewed": true once you\'re happy and it sends automatically to everyone waiting\n' +
      '(within 15 min of the push going live). Leave it false to get a draft to check first.\n',
    { name: 'FMNP fulfilment' });
}

function notifyDraft_(sub, key, subject) {
  sendAsGS_(FULFIL.ADMIN, 'FMNP: draft ready to check — ' + sub.system + ' ' + sub.code,
      'A planting-list draft is in Gmail Drafts: "' + subject + '"\n' +
      'To: ' + sub.email + '\nAddress: ' + (sub.address || '(none)') + '\n\n' +
      'The list (lists/' + key + '.json) isn\'t marked reviewed yet. Check it, send the draft,\n' +
      'then set "reviewed": true so future requests for this community send themselves.\n',
    { name: 'FMNP fulfilment' });
}

/* ---------- email ---------- */

function composeList_(list, sub) {
  var place = shortPlace_(sub.address);
  var subject = 'Your indigenous planting list — ' + list.vegTitle + (place ? ', ' + place : '');
  var meta = { vegTitle: list.vegTitle, vegSub: list.vegSub, intro: list.intro,
               address: sub.address || '' };
  return {
    subject: subject,
    html: buildListEmail_(meta, list.layers, sub.token),
    text: buildListText_(meta, list.layers, sub.token)
  };
}

/** "Norseman Street, East Victoria Park, Perth WA 6101" -> "East Victoria Park"; "Moulamein, New South Wales" -> "Moulamein". */
function shortPlace_(address) {
  var STATES = /^(VIC|NSW|QLD|WA|SA|TAS|NT|ACT|Victoria|New South Wales|Queensland|Western Australia|South Australia|Tasmania|Northern Territory|Australian Capital Territory|Australia)$/i;
  var STREET = /\b(St|Street|Rd|Road|Ave|Avenue|Ct|Court|Cres|Crescent|Dr|Drive|Pl|Place|Pde|Parade|Bvd|Blvd|Boulevard|Hwy|Highway|Ln|Lane|Tce|Terrace|Way|Cl|Close|Gr|Grove|Cct|Circuit)\b\.?$/i;
  var parts = String(address || '').split(',').map(function (s) {
      return s.trim().replace(/\s+(VIC|NSW|QLD|WA|SA|TAS|NT|ACT)(\s+\d{4})?$/i, '').replace(/\s+\d{4}$/, '');
    })
    .filter(function (s) { return s && !/^\d+$/.test(s) && !STATES.test(s); });
  if (parts.length && STREET.test(parts[0])) parts.shift();
  return parts[0] || '';
}

function buildListText_(meta, layers, token) {
  var out = ['FIND MY NATIVE PLANTS · A GARDENER & SON PROJECT', '',
             'BEFORE 1750, YOUR ADDRESS STOOD IN', meta.vegTitle, meta.vegSub];
  if (meta.address) out.push(meta.address);
  out.push('', meta.intro, '');
  layers.forEach(function (L) {
    out.push(L.layer.toUpperCase());
    if (L.note) out.push(L.note);
    L.plants.forEach(function (p) { out.push(p[0] + (p[1] ? ' — ' + p[1] : '')); });
    out.push('');
  });
  out.push('These are indigenous to your vegetation community. Ask your local indigenous nursery for',
           'provenance stock — at Gardener & Son we can help: https://gardenerandson.com', '',
           'PUT YOUR GARDEN ON THE MAP',
           'When you plant back into this community, register your garden on the Ecological Registry:',
           'https://ecologicalregistry.org/?utm_source=fmnp&utm_medium=email&utm_campaign=planting-list', '',
           'Gardener & Son · 2 Churchill Street, Mont Albert VIC 3127 · https://findmynativeplants.com.au',
           'You asked us for this planting list and confirmed your email. Unsubscribe: ' + unsubscribeUrl(token));
  return out.join('\n');
}

/**
 * Branded planting-list email. Dark ink on light panels throughout (Gmail can strip dark
 * backgrounds, which makes light-on-dark text vanish). The Registry CTA rides on every send.
 */
function buildListEmail_(meta, layers, token) {
  var green = '#3d4535', beige = '#fff0dc', brass = '#B49A63', ink = '#2b3126', muted = '#5e6356';
  var unsub = unsubscribeUrl(token);
  var registry = 'https://ecologicalregistry.org/?utm_source=fmnp&utm_medium=email&utm_campaign=planting-list';

  var sections = layers.map(function (L) {
    var items = L.plants.map(function (p) {
      return '<tr><td style="padding:4px 0;color:' + ink + ';font-size:15px;line-height:1.5">' +
             '<i>' + esc_(p[0]) + '</i>' +
             (p[1] ? ' <span style="color:' + muted + '">— ' + esc_(p[1]) + '</span>' : '') +
             '</td></tr>';
    }).join('');
    return '<tr><td style="padding:22px 0 4px">' +
             '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:18px;color:' + green + ';font-weight:bold">' + esc_(L.layer) + '</div>' +
             (L.note ? '<div style="font-size:13px;color:' + muted + ';margin:2px 0 6px">' + esc_(L.note) + '</div>' : '') +
           '</td></tr>' +
           '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + items + '</table></td></tr>';
  }).join('');

  return '' +
  '<div style="background-color:' + beige + ';padding:0;margin:0">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + beige + '" style="background-color:' + beige + '">' +
  '<tr><td align="center" style="padding:32px 16px">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +

    '<tr><td style="padding:0 4px 14px;color:' + green + ';font-family:monospace;font-size:12px;letter-spacing:2px;border-bottom:2px solid ' + green + '">' +
      'FIND MY NATIVE PLANTS · A GARDENER &amp; SON PROJECT</td></tr>' +

    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:34px 30px 8px">' +
      '<div style="font-family:monospace;font-size:11px;letter-spacing:1px;color:' + muted + '">BEFORE 1750, YOUR ADDRESS STOOD IN</div>' +
      '<div style="font-family:Georgia,serif;font-size:30px;line-height:1.1;color:' + green + ';margin:8px 0 6px">' + esc_(meta.vegTitle) + '</div>' +
      '<div style="font-size:13px;color:' + muted + '">' + esc_(meta.vegSub) + '</div>' +
      (meta.address ? '<div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:' + green + ';margin-top:10px">' + esc_(meta.address) + '</div>' : '') +
      '<p style="font-size:15px;line-height:1.7;color:' + ink + ';margin:18px 0 0">' + esc_(meta.intro) + '</p>' +
    '</td></tr>' +

    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:6px 30px 30px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + sections + '</table>' +
      '<div style="border-top:1px solid ' + brass + ';margin-top:26px;padding-top:16px;font-size:13px;line-height:1.6;color:' + ink + '">' +
        'These are indigenous to your vegetation community. Ask your local indigenous nursery for ' +
        'provenance stock — at <a href="https://gardenerandson.com" style="color:' + green + '">Gardener &amp; Son</a> we can help.' +
      '</div>' +
    '</td></tr>' +

    // Ecological Registry CTA — carried on every send.
    '<tr><td bgcolor="' + beige + '" style="background-color:' + beige + ';padding:26px 30px;border-top:1px solid ' + brass + '">' +
      '<div style="font-family:Georgia,serif;font-size:20px;color:' + green + ';line-height:1.2">Put your garden on the map.</div>' +
      '<p style="font-size:14px;line-height:1.6;color:' + ink + ';margin:8px 0 16px">' +
        'When you plant back into this community, register your garden on the Ecological Registry — ' +
        'a public record of the native habitat being rebuilt, garden by garden, across Australia.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="' + green + '" style="background-color:' + green + ';padding:12px 22px">' +
        '<a href="' + registry + '" style="color:' + beige + ';text-decoration:none;font-family:monospace;font-size:14px;letter-spacing:1px">REGISTER YOUR GARDEN &rarr;</a>' +
      '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding:22px 4px;color:' + ink + ';font-size:12px;line-height:1.7;border-top:1px solid ' + brass + '">' +
      '<strong>Gardener &amp; Son</strong><br>2 Churchill Street, Mont Albert VIC 3127<br>' +
      '<a href="https://findmynativeplants.com.au" style="color:' + green + '">findmynativeplants.com.au</a>' +
      '<div style="margin-top:12px;font-size:11px;color:' + muted + '">' +
        'You asked us for this planting list at findmynativeplants.com.au and confirmed your email. ' +
        'Prefer not to hear from us? <a href="' + unsub + '" style="color:' + green + '">Unsubscribe instantly</a>.' +
      '</div>' +
    '</td></tr>' +

  '</table></td></tr></table></div>';
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
