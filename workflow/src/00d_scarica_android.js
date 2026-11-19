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
// due permessi nello stesso accesso: le recensioni (API) e la lettura dei report mensili (Cloud Storage)
const corpo = b64url({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/devstorage.read_only', aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 });
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
    autore: String(rec.authorName ?? ''),  // solo per il foglio Recensioni: al modello non va
  }];
}

// --- 3. storico: i report mensili delle recensioni che Google tiene in Cloud Storage
// (Play Console -> Scarica report -> Recensioni; file reviews_<pacchetto>_<AAAAMM>.csv in UTF-16, aggiornati ogni
// giorno). Si leggono a ogni giro: le recensioni gia' in archivio vengono scartate dall'unione con l'archivio.
// Serve GOOGLE_PLAY_BUCKET e il permesso dell'account di servizio «Visualizzazione di informazioni sulle app e
// download di report collettivi» (Autorizzazioni account). Se manca, il giro continua e lo scrive.
// Stesse regole di strumenti/importa_play_console.py (identificativo, data, lingue, recensioni senza testo).
let storicoStato = 'non configurato: manca GOOGLE_PLAY_BUCKET';
let storicoFile = 0, storicoRighe = 0;
if (cfg.play_bucket) {
  try {
    const nomi = [];
    let pag = null;
    do {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.play_bucket)}/o?prefix=${encodeURIComponent(`reviews/reviews_${cfg.play_package}_`)}&maxResults=1000${pag ? '&pageToken=' + encodeURIComponent(pag) : ''}`;
      const r = await (async () => { let u; for (let t = 1; t <= 5; t++) { try { return await helpers.httpRequest({ method: 'GET', url, headers: { Authorization: 'Bearer ' + accessToken }, json: true, timeout: 30000 }); } catch (e) { u = e; if (['403', '404'].includes(String(e.httpCode ?? ''))) throw e; await new Promise((ok) => setTimeout(ok, 10000 * 2 ** (t - 1))); } } throw u; })();  // elenco dei report: stessi tentativi dei file
      const d = typeof r === 'string' ? JSON.parse(r) : r;
      nomi.push(...(d.items ?? []).map((o) => o.name).filter((n) => /\.csv$/i.test(n)));
      pag = d.nextPageToken ?? null;
    } while (pag);
    // Cloud Storage a volte non risponde in tempo (timeout su un file): fino a 5 tentativi, attese di 10, 20, 40 e 80 secondi
    const scaricaFile = async (url) => {
      let ultimo;
      for (let t = 1; t <= 5; t++) {
        try {
          return await helpers.httpRequest({ method: 'GET', url, headers: { Authorization: 'Bearer ' + accessToken }, encoding: 'arraybuffer', timeout: 120000 });
        } catch (e) {
          ultimo = e;
          if (String(e.httpCode ?? '') === '403') throw e; // permesso mancante: inutile riprovare
          await new Promise((ok) => setTimeout(ok, 10000 * 2 ** (t - 1)));
        }
      }
      throw ultimo;
    };
    for (const nome of nomi.sort()) {
      const dati = await scaricaFile(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.play_bucket)}/o/${encodeURIComponent(nome)}?alt=media`);
      const nuoveDalFile = daReport(Buffer.from(dati));
      righe.push(...nuoveDalFile);
      storicoFile++;
      storicoRighe += nuoveDalFile.length;
    }
    storicoStato = `ok: ${storicoFile} report mensili, ${storicoRighe} recensioni con testo nelle lingue scelte`;
  } catch (e) {
    const codice = e.httpCode ?? e.cause?.status ?? e.response?.status ?? '';
    storicoStato = String(codice) === '403' || /403|forbidden|denied/i.test(e.message)
      ? 'permesso sui report non ancora attivo (Google puo\' metterci fino a un giorno dopo che e\' stato dato)'
      : 'report mensili non letti: ' + e.message;
  }
}

function testoDelFile(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.slice(2)); b.swap16(); return b.toString('utf16le'); }
  const t = buf.toString('utf8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}
function leggiCsv(t) {
  const out = []; let campo = '', riga = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true; else if (c === ',') { riga.push(campo); campo = ''; }
    else if (c === '\n') { riga.push(campo); out.push(riga); riga = []; campo = ''; } else if (c !== '\r') campo += c;
  }
  if (campo || riga.length) { riga.push(campo); out.push(riga); }
  const [h, ...r] = out;
  return r.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k.trim(), x[i] ?? ''])));
}
function daReport(buf) {
  const out = [];
  for (const r of leggiCsv(testoDelFile(buf))) {
    const lingua = String(r['Reviewer Language'] ?? '').trim().toLowerCase().slice(0, 2);
    if (cfg.play_lingue.length && !cfg.play_lingue.includes(lingua)) continue;
    const testo = String(r['Review Text'] ?? '').trim(), titolo = String(r['Review Title'] ?? '').trim();
    if (!testo && !titolo) continue; // solo stelle: niente da analizzare
    let id = '';
    const m = String(r['Review Link'] ?? '').match(/[?&]reviewid=([^&]+)/i);
    if (m) id = decodeURIComponent(m[1]);
    else id = 'pc:' + crypto.createHash('sha1').update([r['Review Submit Millis Since Epoch'] ?? '', r['Star Rating'] ?? '', r['Review Text'] ?? ''].join('|'), 'utf8').digest('hex').slice(0, 16);
    let data = '';
    for (const campo of ['Review Last Update Millis Since Epoch', 'Review Submit Millis Since Epoch']) {
      const v = String(r[campo] ?? '').trim();
      if (/^\d+$/.test(v)) { data = new Date(Number(v)).toISOString().slice(0, 10); break; }
    }
    if (!data) data = String(r['Review Submit Date and Time'] ?? '').trim().slice(0, 10);
    out.push({ id_store: id, title: titolo, rating: String(r['Star Rating'] ?? '').trim(), travelDate: '', publishedDate: data, text: testo,
      piattaforma: 'android', versione: String(r['App Version Name'] ?? '').trim(), paese: lingua, autore: '' });  // i report non hanno il nome
  }
  return out;
}

// la stessa recensione puo' arrivare dall'API e dal report: si tiene la prima (l'API, piu' aggiornata)
const viste = new Set();
const uniche = righe.filter((r) => r.id_store && !viste.has(r.id_store) && viste.add(r.id_store));
return esito(uniche, errore ? 'scaricate in parte: ' + errore : 'ok', { pagine, storico_stato: storicoStato, storico_file: storicoFile, storico_righe: storicoRighe });
