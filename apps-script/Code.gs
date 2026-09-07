/**
 * Find My Native Plants — double opt-in email capture (Spam Act 2003 compliant)
 * ---------------------------------------------------------------------------
 * Flow:
 *   1. The website POSTs {action:'subscribe', email, address, state, code, name, consent, ...}
 *      to this web app. We store a PENDING row and email a single confirmation link.
 *   2. The person clicks the link  -> GET ?action=confirm&token=...   -> status CONFIRMED,
 *      then redirected to /confirmed/.
 *   3. Every list email you later send includes an unsubscribe link
 *      GET ?action=unsubscribe&token=...  -> status UNSUBSCRIBED, redirect to /unsubscribed/.
 *
 * DEPLOY
 *   1. Create a Google Sheet. Put its ID in SHEET_ID below (the long id in the URL).
 *   2. Extensions > Apps Script — paste this file. Save.
 *   3. Deploy > New deployment > type "Web app":
 *        Execute as: Me      Who has access: Anyone
 *      Copy the /exec URL.
 *   4. Paste that URL into app.js  ->  CFG.optinEndpoint.
 *   5. First run will prompt for authorisation (Sheets + send email as you). Approve.
 *
 * Notes
 *   - MailApp sends from the Google account that owns the script. Set FROM_NAME so the
 *     display name reads "Gardener & Son", and consider a Gmail "Send mail as" alias if
 *     you want a branded from-address.
 *   - Apps Script web apps can't return a real 302, so confirm/unsubscribe return a tiny
 *     HTML page that redirects. Bots that pre-fetch links won't run the JS; the status is
 *     still set server-side on the GET, which is what matters.
 */

var CONFIG = {
  SHEET_ID: '1rBGS6xdEqmXb_1kK7Plffi4UGE0mTCWZvfAO-0S7K1E',
  SHEET_NAME: 'subscribers',
  SITE: 'https://findmynativeplants.com.au',
  CONFIRM_REDIRECT: 'https://findmynativeplants.com.au/confirmed/',
  UNSUB_REDIRECT: 'https://findmynativeplants.com.au/unsubscribed/',
  FROM_NAME: 'Gardener & Son — Find My Native Plants',
  STUDIO: 'Gardener & Son · 2 Churchill Street, Mont Albert VIC 3127'
};

var HEADERS = ['timestamp','email','status','token','address','state','system','code','name',
               'consent','consentText','source','page','confirmedAt','unsubscribedAt'];

function sheet_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function findRowByToken_(sh, token) {
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][3]) === String(token)) return i + 1; // 1-based row
  }
  return -1;
}

/** Web app entry — subscribe (POST). */
function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var email = String(p.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) return json_({ ok: false, error: 'invalid email' });
    if (String(p.consent) !== 'true') return json_({ ok: false, error: 'consent required' });

    var sh = sheet_();
    var token = Utilities.getUuid();
    sh.appendRow([
      new Date(), email, 'PENDING', token,
      p.address || '', p.state || '', p.system || '', p.code || '', p.name || '',
      'true', p.consentText || '', p.source || 'fmnp', p.page || '', '', ''
    ]);

    sendConfirmationEmail_(email, token, p);
    return json_({ ok: true, status: 'pending' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Web app entry — confirm / unsubscribe (GET, clicked from an email). */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action;
  var token = p.token;
  if ((action === 'confirm' || action === 'unsubscribe') && token) {
    var sh = sheet_();
    var row = findRowByToken_(sh, token);
    if (row > 0) {
      if (action === 'confirm') {
        sh.getRange(row, 3).setValue('CONFIRMED');
        sh.getRange(row, 14).setValue(new Date());
        return redirect_(CONFIG.CONFIRM_REDIRECT);
      } else {
        sh.getRange(row, 3).setValue('UNSUBSCRIBED');
        sh.getRange(row, 15).setValue(new Date());
        return redirect_(CONFIG.UNSUB_REDIRECT);
      }
    }
  }
  // Unknown / expired token — send them somewhere sensible.
  return redirect_(CONFIG.SITE + '/');
}

function sendConfirmationEmail_(email, token, p) {
  var confirmUrl = ScriptApp.getService().getUrl() + '?action=confirm&token=' + encodeURIComponent(token);
  var veg = [p.name, p.code].filter(function (x) { return x; }).join(' · ');
  var subject = 'Confirm your Find My Native Plants list';
  var body =
    'Thanks for asking for the indigenous planting list' + (veg ? ' for ' + veg : '') + '.\n\n' +
    'Please confirm this email address by clicking the link below — you will not receive anything ' +
    'from us until you do:\n\n' + confirmUrl + '\n\n' +
    'If you did not request this, simply ignore this email and nothing further will be sent.\n\n' +
    '— ' + CONFIG.FROM_NAME + '\n' + CONFIG.STUDIO + '\n' + CONFIG.SITE + '\n';

  var html =
    '<div style="font-family:Georgia,serif;color:#2b3126;max-width:520px;line-height:1.6">' +
    '<p>Thanks for asking for the indigenous planting list' + (veg ? ' for <strong>' + escapeHtml_(veg) + '</strong>' : '') + '.</p>' +
    '<p>Please confirm this email address — you won’t receive anything from us until you do:</p>' +
    '<p><a href="' + confirmUrl + '" style="display:inline-block;background:#3d4535;color:#fff0dc;' +
    'padding:12px 22px;text-decoration:none;font-family:monospace">Confirm my email &rarr;</a></p>' +
    '<p style="font-size:13px;color:#6b6f63">If you didn’t request this, ignore this email and nothing further will be sent.</p>' +
    '<hr style="border:none;border-top:1px solid #B49A63;margin:22px 0">' +
    '<p style="font-size:12px;color:#6b6f63">' + escapeHtml_(CONFIG.FROM_NAME) + '<br>' +
    escapeHtml_(CONFIG.STUDIO) + '<br><a href="' + CONFIG.SITE + '">' + CONFIG.SITE + '</a></p></div>';

  MailApp.sendEmail({ to: email, subject: subject, body: body, htmlBody: html, name: CONFIG.FROM_NAME });
}

/**
 * Helper for your species-list sends (the FMEG pipeline): build the unsubscribe URL for a
 * subscriber's token so every marketing email carries a working one-click unsubscribe.
 */
function unsubscribeUrl(token) {
  return ScriptApp.getService().getUrl() + '?action=unsubscribe&token=' + encodeURIComponent(token);
}

function redirect_(url) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="0;url=' + url + '">' +
    '<script>location.replace(' + JSON.stringify(url) + ')</script>' +
    '<p>Redirecting… <a href="' + url + '">continue</a></p>'
  );
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
