// SCARICA LE RECENSIONI iOS
// 1. Feed pubblico dell'App Store, per ogni paese di STORE_PAESI (predefiniti it, gb, us): al massimo le 500
//    recensioni piu' recenti per paese, CON la versione dell'app.
// 2. Se il feed non da' niente (17/11: vuoto per tutte le app, anche per le piu' grandi) e la chiave di App Store
//    Connect e' configurata (APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_P8_B64), si usa l'API ufficiale: tutte le
//    recensioni degli ultimi APPLE_API_GIORNI giorni (predefiniti 45) per gli stessi paesi, SENZA la versione
//    (l'API non la da': resta «non indicata», non si stima).
// Ogni recensione ha un identificativo dello store (id_store): serve a non aggiungere due volte la stessa
// recensione all'archivio e a riconoscere quelle NUOVE. Feed e API hanno identificativi diversi: l'unione con
// l'archivio riconosce la stessa recensione anche da paese, data, voto e titolo.
// Il nome dell'autore (il soprannome nello store) si salva nell'archivio e va SOLO nel foglio Recensioni dell'Excel:
// serve a chi legge per ritrovare l'utente nel customer care (richiesta di chi legge i risultati). Al modello non va mai.
// 3. Nomi per lo storico: se la chiave dell'API c'e', si leggono dall'API anche i nomi di TUTTE le recensioni iOS
//    (circa 17 pagine). Servono solo a dare il nome alle recensioni gia' nell'archivio: non aggiungono righe.
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const helpers = this.helpers;
const TERRITORIO = { it: 'ITA', gb: 'GBR', us: 'USA', es: 'ESP', fr: 'FRA', de: 'DEU', ch: 'CHE' };
const attesa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const righe = [];
const pagine = [];
if (!cfg.app_store_id) return [{ json: { scaricate: 0, pagine, righe, stato: 'non configurato: manca APP_STORE_ID' } }];

// --- 1. feed pubblico, paese per paese
for (const paese of cfg.store_paesi) {
  for (let p = 1; p <= 10; p++) {
    const url = `https://itunes.apple.com/${paese}/rss/customerreviews/page=${p}/id=${cfg.app_store_id}/sortby=mostrecent/json`;
    let dati;
    try {
      dati = await helpers.httpRequest({ method: 'GET', url, json: true, timeout: 30000 });
    } catch (e) {
      pagine.push({ paese, pagina: p, errore: e.message });
      break;
    }
    if (typeof dati === 'string') dati = JSON.parse(dati);
    const voci = [].concat(dati?.feed?.entry ?? []).filter((e) => e['im:rating']);
    pagine.push({ paese, pagina: p, recensioni: voci.length });
    if (!voci.length) break;
    for (const e of voci) {
      righe.push({
        id_store: String(e.id?.label ?? ''),
        title: String(e.title?.label ?? ''),
        rating: String(e['im:rating']?.label ?? ''),
        travelDate: '',
        publishedDate: String(e.updated?.label ?? '').slice(0, 10),
        text: String(e.content?.label ?? ''),
        piattaforma: 'ios',
        versione: String(e['im:version']?.label ?? ''),
        paese,
        autore: String(e.author?.name?.label ?? ''),
      });
    }
  }
}
let fonte = righe.length ? 'feed' : null;

// --- 2. API di App Store Connect: le recensioni se il feed e' vuoto, e in ogni caso i nomi per lo storico
let statoApi = null;
const daFeed = righe.length > 0;
const autori = [];   // nomi di tutte le recensioni iOS lette dall'API: servono solo a riempire l'archivio
if (!$env.APPLE_ISSUER_ID || !$env.APPLE_KEY_ID || !$env.APPLE_P8_B64) statoApi = 'API di App Store Connect non configurata';
else {
  try {
    const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const ora = Math.floor(Date.now() / 1000);
    const testa = b64url({ alg: 'ES256', kid: $env.APPLE_KEY_ID, typ: 'JWT' });
    const corpo = b64url({ iss: $env.APPLE_ISSUER_ID, iat: ora, exp: ora + 1200, aud: 'appstoreconnect-v1' });
    const chiave = Buffer.from($env.APPLE_P8_B64, 'base64').toString('utf8');
    const firma = crypto.createSign('SHA256').update(`${testa}.${corpo}`).sign({ key: chiave, dsaEncoding: 'ieee-p1363' }).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const H = { Authorization: `Bearer ${testa}.${corpo}.${firma}` };
    const territori = new Map(cfg.store_paesi.map((p) => [TERRITORIO[p] ?? p.toUpperCase(), p]));
    const limite = new Date(Date.now() - cfg.apple_api_giorni * 86400000).toISOString().slice(0, 10);
    let url = `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(cfg.app_store_id)}/customerReviews?limit=200&sort=-createdDate`;
    let n = 0, aggiunte = 0;
    while (url && n < 50) {
      // il server di Apple a volte non risponde: fino a 5 tentativi con attesa crescente
      let d = null, ultimo = null;
      for (let t = 1; t <= 5 && d === null; t++) {
        try { d = await helpers.httpRequest({ method: 'GET', url, headers: H, json: true, timeout: 60000 }); } catch (e) {
          ultimo = e;
          if (['401', '403'].includes(String(e.httpCode ?? ''))) throw e;
          await attesa(10000 * 2 ** (t - 1));
        }
      }
      if (d === null) throw ultimo;
      if (typeof d === 'string') d = JSON.parse(d);
      n++;
      for (const x of d.data ?? []) {
        const a = x.attributes ?? {};
        const giorno = String(a.createdDate ?? '').slice(0, 10);
        const paese = territori.get(a.territory);
        if (!paese) continue;
        const riga = { id_store: String(x.id), title: String(a.title ?? ''), rating: String(a.rating ?? ''), travelDate: '', publishedDate: giorno, text: String(a.body ?? ''), piattaforma: 'ios', versione: '', paese, autore: String(a.reviewerNickname ?? '') };
        // per i nomi basta riconoscere la recensione: id e chiave di contenuto (del testo serve solo l'inizio)
        if (riga.autore) autori.push({ ...riga, text: riga.text.slice(0, 200) });
        // le recensioni si prendono dall'API solo se il feed e' vuoto, e solo quelle degli ultimi APPLE_API_GIORNI giorni
        if (!daFeed && giorno && giorno >= limite) { righe.push(riga); aggiunte++; }
      }
      url = d.links?.next ?? null;
    }
    pagine.push({ api_app_store_connect: { pagine: n, recensioni: aggiunte, nomi: autori.length, dal: daFeed ? null : limite } });
    if (!daFeed) fonte = 'API di App Store Connect (senza versione)';
    statoApi = 'ok';
  } catch (e) {
    statoApi = 'API di App Store Connect non raggiungibile: ' + e.message;
    pagine.push({ api_app_store_connect: { errore: e.message } });
  }
}
// il giro non si blocca mai per iOS (Android e l'archivio vanno avanti): lo si scrive nel riassunto
const stato = fonte === 'feed' ? 'ok'
  : fonte && statoApi === 'ok' ? 'feed di Apple vuoto: recensioni prese dall\'API di App Store Connect (senza versione dell\'app)'
  : 'feed di Apple vuoto o non raggiungibile in questo giro' + (statoApi ? ` (${statoApi})` : '');
return [{ json: { scaricate: righe.length, pagine, righe, autori, stato, fonte } }];
