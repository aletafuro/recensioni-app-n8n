// VOTO NEGLI STORE PER MERCATO
// Il voto che si vede negli store NON e' la media delle recensioni scritte: conta anche chi da' solo le stelle.
// Qui si legge il voto vero degli store, per i paesi di VOTO_PAESI (predefiniti Italia, Regno Unito, Stati Uniti),
// e lo si confronta con quello di una settimana prima.
// - iOS: servizio pubblico di Apple (itunes.apple.com/lookup), che da' SOLO il voto di oggi e il numero delle
//   valutazioni. Lo storico lo costruisce il programma: ogni giro salva un'istantanea in storico_voti.json. Dal
//   numero delle valutazioni si ricava anche quanti voti sono arrivati nella settimana e la loro media:
//   (voto oggi x valutazioni oggi - voto prima x valutazioni prima) / (valutazioni oggi - valutazioni prima).
// - Android: report giornalieri della Play Console (stats/ratings/..._country.csv nello stesso spazio dei report
//   delle recensioni), con il voto totale e quello del giorno per paese, dal 2019. Google NON da' il numero delle
//   valutazioni: si vede l'andamento ma non si puo' dire se una differenza e' oltre il rumore. I report arrivano
//   con qualche giorno di ritardo: si scrive fino a che giorno arrivano i dati.
// Se una fonte non risponde il giro continua e lo scrive. Nessun numero viene inventato o stimato.
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const helpers = this.helpers;
const NOMI = { it: 'Italia', gb: 'Regno Unito', us: 'Stati Uniti', es: 'Spagna', fr: 'Francia', de: 'Germania', ch: 'Svizzera' };
const paesi = cfg.voto_paesi;
const oggi = cfg.grappolo_oggi ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const giorno = (d) => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000);
const comeData = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(100 * x) / 100);

let storico = { istantanee_ios: [] };
try {
  const d = $('Estrai storico voti').first().json.data;
  if (d && Array.isArray(d.istantanee_ios)) storico = d;
} catch (e) {
  // primo giro: nessuno storico
}

// --- iOS: voto di oggi per paese, confronto con l'istantanea di circa una settimana prima
const ios = { fonte: 'App Store (itunes.apple.com/lookup)', stato: 'ok', paesi: [] };
if (!cfg.app_store_id) ios.stato = 'non configurato: manca APP_STORE_ID';
else {
  for (const p of paesi) {
    try {
      let d = await helpers.httpRequest({ method: 'GET', url: `https://itunes.apple.com/lookup?id=${encodeURIComponent(cfg.app_store_id)}&country=${p}`, json: true, timeout: 30000 });
      if (typeof d === 'string') d = JSON.parse(d);
      const a = d?.results?.[0];
      if (!a || typeof a.averageUserRating !== 'number') { ios.paesi.push({ paese: p, nome: NOMI[p] ?? p, stato: 'app non trovata in questo paese' }); continue; }
      const voto = a.averageUserRating, valutazioni = a.userRatingCount ?? null;
      // istantanea di oggi (una per giorno e paese: se il giro si ripete lo stesso giorno, si sostituisce)
      storico.istantanee_ios = storico.istantanee_ios.filter((x) => !(x.data === oggi && x.paese === p));
      storico.istantanee_ios.push({ data: oggi, paese: p, voto, valutazioni, versione: a.version ?? null });
      // confronto: l'istantanea piu' recente di almeno 6 giorni prima
      const prima = storico.istantanee_ios.filter((x) => x.paese === p && giorno(oggi) - giorno(x.data) >= 6)
        .sort((x, y) => y.data.localeCompare(x.data))[0] ?? null;
      const riga = { paese: p, nome: NOMI[p] ?? p, stato: 'ok', voto: r2(voto), valutazioni, versione: a.version ?? null };
      if (prima) {
        riga.voto_prima = r2(prima.voto);
        riga.valutazioni_prima = prima.valutazioni;
        riga.data_prima = prima.data;
        const nuove = valutazioni !== null && prima.valutazioni !== null ? valutazioni - prima.valutazioni : null;
        riga.voti_nuovi = nuove;
        const media = nuove > 0 ? (voto * valutazioni - prima.voto * prima.valutazioni) / nuove : null;
        // controllo di coerenza: le stelle vanno da 1 a 5 (con un piccolo margine per gli arrotondamenti di Apple).
        // Fuori da qui i dati di Apple non sono coerenti tra loro (voto e numero aggiornati in momenti diversi,
        // valutazioni azzerate con una versione nuova): si dice «non calcolabile», non si scrive un numero sbagliato.
        if (media !== null && media >= 0.95 && media <= 5.05) riga.media_voti_nuovi = r2(Math.min(5, Math.max(1, media)));
        else if (nuove !== null) riga.media_voti_nuovi_nota = nuove <= 0 ? 'nessun voto nuovo (o valutazioni azzerate da Apple)' : 'non calcolabile: dati di Apple non coerenti';
      }
      ios.paesi.push(riga);
    } catch (e) {
      ios.paesi.push({ paese: p, nome: NOMI[p] ?? p, stato: 'non raggiungibile: ' + e.message });
    }
  }
}

// --- Android: report giornalieri della Play Console per paese
const android = { fonte: 'Play Console, report delle valutazioni per paese', stato: 'ok', paesi: [], serie_settimanale: [] };
if (!cfg.play_bucket || !cfg.play_package || !$env.GOOGLE_PLAY_CREDENZIALI_B64) android.stato = 'non configurato: servono GOOGLE_PLAY_BUCKET, GOOGLE_PLAY_PACKAGE e GOOGLE_PLAY_CREDENZIALI_B64';
else {
  try {
    const account = JSON.parse(Buffer.from($env.GOOGLE_PLAY_CREDENZIALI_B64, 'base64').toString('utf8'));
    const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const ora = Math.floor(Date.now() / 1000);
    const testa = b64url({ alg: 'RS256', typ: 'JWT' });
    const corpo = b64url({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_only', aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 });
    const firma = crypto.createSign('RSA-SHA256').update(`${testa}.${corpo}`).sign(account.private_key, 'base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    let t = await helpers.httpRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${testa}.${corpo}.${firma}`, json: true, timeout: 30000 });
    if (typeof t === 'string') t = JSON.parse(t);
    const H = { Authorization: 'Bearer ' + t.access_token };
    const nomi = [];
    let pag = null;
    do {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.play_bucket)}/o?prefix=${encodeURIComponent(`stats/ratings/ratings_${cfg.play_package}_`)}&maxResults=1000${pag ? '&pageToken=' + encodeURIComponent(pag) : ''}`;
      let d = await (async () => { let u; for (let t = 1; t <= 5; t++) { try { return await helpers.httpRequest({ method: 'GET', url, headers: H, json: true, timeout: 30000 }); } catch (e) { u = e; if (['403', '404'].includes(String(e.httpCode ?? ''))) throw e; await new Promise((ok) => setTimeout(ok, 10000 * 2 ** (t - 1))); } } throw u; })();  // elenco dei report: stessi tentativi dei file
      if (typeof d === 'string') d = JSON.parse(d);
      nomi.push(...(d.items ?? []).map((o) => o.name).filter((n) => /_country\.csv$/.test(n)));
      pag = d.nextPageToken ?? null;
    } while (pag);
    // righe per paese e giorno, da tutti i mesi (per l'andamento settimanale nell'Excel)
    const perPaese = new Map(paesi.map((p) => [p.toUpperCase(), new Map()]));
    for (const nome of nomi.sort()) {
      // Cloud Storage a volte non risponde in tempo (timeout su un file): fino a 5 tentativi, attese di 10, 20, 40 e 80 secondi
      let dati = null, ultimo = null;
      for (let t = 1; t <= 5 && dati === null; t++) {
        try {
          dati = await helpers.httpRequest({ method: 'GET', url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(cfg.play_bucket)}/o/${encodeURIComponent(nome)}?alt=media`, headers: H, encoding: 'arraybuffer', timeout: 120000 });
        } catch (e) {
          ultimo = e;
          if (String(e.httpCode ?? '') === '403') throw e;
          await new Promise((ok) => setTimeout(ok, 10000 * 2 ** (t - 1)));
        }
      }
      if (dati === null) throw ultimo;
      const buf = Buffer.from(dati);
      const testo = buf[0] === 0xff && buf[1] === 0xfe ? buf.slice(2).toString('utf16le') : buf.toString('utf8').replace(/^﻿/, '');
      const [intest, ...righe] = testo.split(/\r?\n/).filter(Boolean);
      const col = intest.split(',').map((c) => c.trim());
      const iD = col.indexOf('Date'), iC = col.indexOf('Country'), iG = col.indexOf('Daily Average Rating'), iT = col.indexOf('Total Average Rating');
      for (const r of righe) {
        const c = r.split(',');
        const m = perPaese.get(String(c[iC] ?? '').trim());
        if (!m) continue;
        // nei giorni senza voti Google scrive 0.0 (non lascia vuoto): un valore fuori da 1-5 vuol dire «nessun voto»
        const tot = parseFloat(c[iT]), gio = parseFloat(c[iG]);
        const stelle = (x) => (x >= 1 && x <= 5 ? x : null);
        m.set(String(c[iD]).trim(), { totale: stelle(tot), del_giorno: stelle(gio) });
      }
    }
    for (const p of paesi) {
      const m = perPaese.get(p.toUpperCase());
      const date = [...m.keys()].filter((d) => m.get(d).totale !== null).sort();
      if (!date.length) { android.paesi.push({ paese: p, nome: NOMI[p] ?? p, stato: 'nessun dato per questo paese' }); continue; }
      const ultima = date[date.length - 1];
      const prima = date.filter((d) => giorno(ultima) - giorno(d) >= 7).pop() ?? null;
      android.paesi.push({
        paese: p, nome: NOMI[p] ?? p, stato: 'ok', dati_fino_al: ultima, voto: r2(m.get(ultima).totale),
        data_prima: prima, voto_prima: prima ? r2(m.get(prima).totale) : null,
      });
      // serie settimanale: il voto totale di ogni domenica (o dell'ultimo giorno disponibile prima) e la media dei
      // voti dati nella settimana (lunedi'-domenica; l'ultima riga va dal lunedi' all'ultimo giorno con i dati).
      // Google da' per ogni giorno la media dei voti di quel giorno ma NON quanti sono: la media della settimana e'
      // la media semplice dei giorni con voti (un giorno con 1 voto pesa come un giorno con 100). Si scrive anche
      // in quanti giorni ci sono voti, perche' con pochi giorni la media dice poco.
      let inizio = giorno(date[0]);
      for (let g = giorno(date[0]); g <= giorno(ultima); g++) {
        const d = comeData(g);
        if (new Date(g * 86400000).getUTCDay() !== 0 && d !== ultima) continue;
        const v = date.filter((x) => x <= d).pop();
        const delGiorno = [];
        for (let k = inizio; k <= g; k++) { const x = m.get(comeData(k))?.del_giorno; if (x !== null && x !== undefined) delGiorno.push(x); }
        if (v) android.serie_settimanale.push({
          paese: p, nome: NOMI[p] ?? p, settimana_fino_al: d, dati_del: v, voto: r2(m.get(v).totale),
          media_voti_settimana: delGiorno.length ? r2(delGiorno.reduce((a, b) => a + b, 0) / delGiorno.length) : null,
          giorni_con_voti: delGiorno.length, giorni_della_settimana: g - inizio + 1,
        });
        inizio = g + 1;
      }
    }
    android.report_letti = nomi.length;
  } catch (e) {
    const codice = String(e.httpCode ?? e.cause?.status ?? e.response?.status ?? '');
    android.stato = codice === '403' || /403|forbidden|denied/i.test(e.message) ? 'permesso sui report non attivo' : 'report non letti: ' + e.message;
    // Google non ha risposto nemmeno dopo i tentativi: si mostrano i voti dell'ultimo giro riuscito, dicendo di quando
    // sono (meglio un dato vecchio dichiarato che nessun dato); il giro dopo ci riprova
    const precedente = storico.ultimo_giro?.android;
    if (precedente && Array.isArray(precedente.paesi) && precedente.paesi.some((p) => p.stato === 'ok')) {
      const quando = precedente.dati_del_giro ?? storico.ultimo_giro.oggi;
      android.paesi = precedente.paesi;
      android.dati_del_giro = quando;
      android.stato = `Google non ha risposto in questo giro: voti del giro del ${String(quando).slice(8, 10)}/${String(quando).slice(5, 7)}`;
    }
  }
}
if (android.stato === 'ok') android.dati_del_giro = oggi;

// --- versione pubblicata oggi negli store (richiesta del 17/11: negli avvisi a grappolo dire se la versione con
// il problema e' quella che la gente scarica adesso, non solo «la piu' recente vista nelle recensioni»)
// - iOS: il campo version del servizio pubblico di Apple letto sopra;
// - Android: la traccia di produzione dell'API di Google Play. Per leggerla Google chiede di aprire una bozza
//   («edit») che poi si cancella subito: non si pubblica e non si cambia niente. Il nome della release e'
//   del tipo «375 (3.3.8)»: si prende il numero tra parentesi, che e' quello scritto nelle recensioni.
const versione_pubblicata = { ios: ios.paesi.find((p) => p.versione)?.versione ?? null, android: null, android_stato: 'ok' };
if (!cfg.play_package || !$env.GOOGLE_PLAY_CREDENZIALI_B64) versione_pubblicata.android_stato = 'non configurato';
else {
  try {
    const account = JSON.parse(Buffer.from($env.GOOGLE_PLAY_CREDENZIALI_B64, 'base64').toString('utf8'));
    const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const ora = Math.floor(Date.now() / 1000);
    const testa = b64url({ alg: 'RS256', typ: 'JWT' });
    const corpo = b64url({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: ora, exp: ora + 3600 });
    const firma = crypto.createSign('RSA-SHA256').update(`${testa}.${corpo}`).sign(account.private_key, 'base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    let t = await helpers.httpRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${testa}.${corpo}.${firma}`, json: true, timeout: 30000 });
    if (typeof t === 'string') t = JSON.parse(t);
    const H = { Authorization: 'Bearer ' + t.access_token };
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(cfg.play_package)}/edits`;
    let e = await helpers.httpRequest({ method: 'POST', url: base, headers: H, json: true, timeout: 30000 });
    if (typeof e === 'string') e = JSON.parse(e);
    try {
      let tr = await helpers.httpRequest({ method: 'GET', url: `${base}/${e.id}/tracks/production`, headers: H, json: true, timeout: 30000 });
      if (typeof tr === 'string') tr = JSON.parse(tr);
      // la release completata; durante un rilascio graduale c'e' anche quella «inProgress», che e' la piu' nuova
      const rel = (tr.releases ?? []).find((r) => r.status === 'inProgress') ?? (tr.releases ?? []).find((r) => r.status === 'completed');
      if (rel) {
        versione_pubblicata.android = (String(rel.name ?? '').match(/\(([^)]+)\)/)?.[1] ?? rel.name ?? null);
        if (rel.status === 'inProgress') versione_pubblicata.android_stato = `in rilascio graduale (${Math.round(100 * (rel.userFraction ?? 0))}% degli utenti)`;
      } else versione_pubblicata.android_stato = 'nessuna release in produzione';
    } finally {
      await helpers.httpRequest({ method: 'DELETE', url: `${base}/${e.id}`, headers: H, timeout: 30000 }).catch(() => {});
    }
  } catch (e) {
    versione_pubblicata.android_stato = 'non letta: ' + e.message;
  }
}

const risultato = { generato_il: new Date().toISOString(), oggi, paesi, ios, android, versione_pubblicata, istantanee_ios: storico.istantanee_ios };
return [{
  json: { path: `${cfg.output_dir}/storico_voti.json`, voto_store: risultato },
  // nel file anche il risultato dell'ultimo giro (senza la serie lunga di Android), per poterlo controllare
  binary: { data: { data: Buffer.from(JSON.stringify({ istantanee_ios: storico.istantanee_ios, ultimo_giro: { ...risultato, istantanee_ios: undefined, android: { ...android, serie_settimanale: undefined } } }, null, 1), 'utf8').toString('base64'), mimeType: 'application/json', fileName: 'storico_voti.json' } },
}];
