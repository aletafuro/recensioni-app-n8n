// SCARICA LE RECENSIONI ANDROID (API ufficiale di Google Play)
// Google Play non ha un feed pubblico e scaricare le pagine del Play Store va contro i termini di Google.
// La strada ufficiale e' la Google Play Developer API (reviews.list): restituisce le recensioni scritte
// o modificate negli ULTIMI 7 GIORNI, quindi va bene per il giro settimanale. Lo storico si importa
// una volta dalle esportazioni CSV della Play Console (strumenti/importa_play_console.py).
// Serve un account di servizio Google collegato alla Play Console con il permesso di leggere le recensioni:
// il suo file JSON va nel .env, codificato in base64, nella variabile GOOGLE_PLAY_CREDENZIALI_B64.
// Se manca qualcosa, il giro continua solo con iOS e lo scrive (nessun errore).
// L'autore non si salva: all'analisi non serve.
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const helpers = this.helpers;
const esito = (righe, stato, extra = {}) => [{ json: { righe, stato, scaricate: righe.length, ...extra } }];

if (!cfg.play_package) return esito([], 'non configurato: manca GOOGLE_PLAY_PACKAGE (nome del pacchetto dell\'app Android)');
if (!$env.GOOGLE_PLAY_CREDENZIALI_B64) return esito([], 'non configurato: manca GOOGLE_PLAY_CREDENZIALI_B64 (account di servizio della Play Console)');

// --- 1. accesso: JWT firmato con la chiave dell'account di servizio, scambiato con un token di Google
let account;
try {
  account = JSON.parse(Buffer.from($env.GOOGLE_PLAY_CREDENZIALI_B64, 'base64').toString('utf8'));
} catch (e) {
  return esito([], 'errore: GOOGLE_PLAY_CREDENZIALI_B64 non contiene un JSON valido');
}
const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const ora = Math.floor(Date.now() / 1000);
const testa = b64url({ alg: 'RS256', typ: 'JWT' });
const corpo = b64url({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 });
const firma = crypto.createSign('RSA-SHA256').update(`${testa}.${corpo}`).sign(account.private_key, 'base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let accessToken;
try {
  const t = await helpers.httpRequest({
    method: 'POST', url: 'https://oauth2.googleapis.com/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${testa}.${corpo}.${firma}`,
    json: true, timeout: 30000,
  });
  accessToken = (typeof t === 'string' ? JSON.parse(t) : t).access_token;
} catch (e) {
  return esito([], 'errore di accesso a Google: ' + e.message);
}

// --- 2. recensioni degli ultimi 7 giorni, pagina per pagina
const righe = [];
let pagina = null, pagine = 0, errore = null;
do {
  try {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.play_package)}/reviews?maxResults=100${pagina ? '&token=' + encodeURIComponent(pagina) : ''}`;
    const r = await helpers.httpRequest({ method: 'GET', url, headers: { Authorization: 'Bearer ' + accessToken }, json: true, timeout: 30000 });
    const d = typeof r === 'string' ? JSON.parse(r) : r;
    for (const rec of d.reviews ?? []) righe.push(...daRecensioneApi(rec));
    pagina = d.tokenPagination?.nextPageToken ?? null;
    pagine++;
  } catch (e) {
    errore = e.message;
    pagina = null;
  }
} while (pagina && pagine < 20);

// trasformazione di una recensione dell'API nelle colonne dell'archivio
function daRecensioneApi(rec) {
  const u = (rec.comments ?? []).map((c) => c.userComment).find(Boolean);
  if (!u) return [];
  const lingua = String(u.reviewerLanguage ?? '').slice(0, 2).toLowerCase();
  if (cfg.play_lingue.length && !cfg.play_lingue.includes(lingua)) return [];
  // nel testo dell'API titolo e testo sono separati da una tabulazione (quando il titolo c'e')
  const testo = String(u.text ?? '');
  const tab = testo.indexOf('\t');
  const secondi = Number(u.lastModified?.seconds ?? 0);
  return [{
    id_store: String(rec.reviewId ?? ''),
    title: tab >= 0 ? testo.slice(0, tab).trim() : '',
    rating: String(u.starRating ?? ''),
    travelDate: '',
    publishedDate: secondi ? new Date(secondi * 1000).toISOString().slice(0, 10) : '',
    text: (tab >= 0 ? testo.slice(tab + 1) : testo).trim(),
    piattaforma: 'android',
    versione: String(u.appVersionName ?? ''),
    paese: lingua,
  }];
}

return esito(righe.filter((r) => r.id_store), errore ? 'scaricate in parte: ' + errore : 'ok', { pagine });
