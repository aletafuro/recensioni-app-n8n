// ASSEGNA ID E PULISCI
// Ogni recensione riceve un identificativo stabile: se il file viene riordinato o
// ricaricato, gli identificativi non cambiano.
// - Se la fonte da' un proprio identificativo (colonna id_store, es. l'id della recensione
//   nel feed Apple): review_id = "R" + primi 10 caratteri di sha1(store|piattaforma|id_store).
//   Due righe con lo stesso id_store sono un duplicato vero (la stessa recensione due volte).
// - Altrimenti: sha1(publishedDate|title|text|rating). Correzione del 14/11: con data,
//   titolo e testo soltanto, due persone diverse che scrivono "Top" lo stesso giorno
//   diventavano "la stessa recensione" e una delle due spariva dai conteggi.
// Si annotano anche i testi lunghi ripetuti da recensioni diverse (possibile campagna
// coordinata): non si scartano, si segnalano.
// Qui si controllano anche i campi e si annotano le anomalie (rumore del file).
const crypto = require('crypto');
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;

const pulisci = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');

const righe = $input.all().map((i) => i.json);
if (righe.length === 0) throw new Error('Nessuna recensione nel file ' + cfg.input_file);
for (const c of ['title', 'rating', 'publishedDate', 'text']) {
  if (!(c in righe[0])) throw new Error('Colonna mancante nel CSV: ' + c);
}

const visti = new Set();
const anomalie = [];
// la data del soggiorno esiste solo per alcuni domini (hotel): se nel file e' sempre vuota non e' un'anomalia
const haDataSoggiorno = righe.some((r) => pulisci(r.travelDate) !== '');
let recensioni = righe.map((r, i) => {
  const riga = i + 2; // la riga 1 del file e' l'intestazione
  const title = pulisci(r.title);
  const text = pulisci(r.text);
  const published = pulisci(r.publishedDate);
  const travelGrezzo = pulisci(r.travelDate);

  const idStore = pulisci(r.id_store ?? '');
  const piattaformaRiga = pulisci(r.piattaforma ?? r.platform ?? '').toLowerCase();
  const h = idStore ? sha1(['store', piattaformaRiga, idStore].join('|')) : sha1([published, title, text, pulisci(r.rating)].join('|'));
  let id = 'R' + h.slice(0, 10);
  let duplicato_di = null;
  if (visti.has(id)) {
    // stesso id dello store, oppure (senza id) stessa data, titolo, testo e voto: duplicato vero
    duplicato_di = id;
    let k = 2;
    while (visti.has(`${id}-${k}`)) k++;
    id = `${id}-${k}`;
    anomalie.push({ riga, review_id: id, tipo: 'duplicato', dettaglio: 'uguale a ' + duplicato_di });
  }
  visti.add(id);

  const n = Number(pulisci(r.rating));
  const rating = Number.isInteger(n) && n >= ctx.voto.minimo && n <= ctx.voto.massimo ? n : null;
  if (rating === null) anomalie.push({ riga, review_id: id, tipo: 'voto_non_valido', dettaglio: String(r.rating ?? '') });

  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(published) && !isNaN(Date.parse(published));
  if (!dataOk) anomalie.push({ riga, review_id: id, tipo: 'data_pubblicazione_non_valida', dettaglio: published });

  let travel = /^\d{4}-\d{2}$/.test(travelGrezzo) ? travelGrezzo : null;
  if (!travelGrezzo && haDataSoggiorno) anomalie.push({ riga, review_id: id, tipo: 'data_soggiorno_mancante', dettaglio: null });
  else if (travelGrezzo && !travel) anomalie.push({ riga, review_id: id, tipo: 'data_soggiorno_non_valida', dettaglio: travelGrezzo });
  if (travel && dataOk && travel > published.slice(0, 7)) {
    anomalie.push({ riga, review_id: id, tipo: 'soggiorno_dopo_pubblicazione', dettaglio: `${travel} > ${published}` });
    travel = null;
  }

  // testo per il modello: spazi multipli ridotti, a capo mantenuti
  const testo = text.replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  const vuota = testo.length === 0 && title.length === 0;
  if (vuota) anomalie.push({ riga, review_id: id, tipo: 'recensione_vuota', dettaglio: null });
  else if (testo.length === 0) anomalie.push({ riga, review_id: id, tipo: 'testo_vuoto_si_usa_il_titolo', dettaglio: null });

  return {
    review_id: id,
    id_store: idStore || null,
    riga,
    ordine_hash: h.slice(10, 18), // ordine pseudo-casuale ma ripetibile
    title,
    text: testo,
    rating,
    published_date: dataOk ? published : null,
    travel_date: travel,
    anno: dataOk ? Number(published.slice(0, 4)) : null,
    // colonne facoltative: piattaforma (ios/android) e versione dell'app
    piattaforma: pulisci(r.piattaforma ?? r.platform ?? '').toLowerCase() || 'non indicata',
    versione: pulisci(r.versione ?? r.version ?? '') || null,
    duplicato_di,
    vuota,
  };
});

// testi lunghi uguali in recensioni diverse: segnale di possibile campagna coordinata
// (un testo breve come "Top" lo scrivono in tanti e non conta; servono almeno 8 parole)
const perTesto = new Map();
for (const r of recensioni) {
  if (r.duplicato_di) continue;
  const t = r.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (t.split(' ').length < 8) continue;
  if (!perTesto.has(t)) perTesto.set(t, []);
  perTesto.get(t).push(r);
}
for (const gruppo of perTesto.values()) {
  if (gruppo.length < 2) continue;
  const date = gruppo.map((r) => r.published_date).filter(Boolean).sort();
  for (const r of gruppo) anomalie.push({ riga: r.riga, review_id: r.review_id, tipo: 'testo_lungo_ripetuto', dettaglio: `stesso testo in ${gruppo.length} recensioni diverse, dal ${date[0]} al ${date[date.length - 1]}` });
}

// ordine cronologico; le recensioni senza data valida in fondo
recensioni.sort(
  (a, b) => (a.published_date ?? '9999').localeCompare(b.published_date ?? '9999') || a.review_id.localeCompare(b.review_id),
);

// LIMIT > 0: campione ripetibile per le prove (ordine dato dall'hash, quindi sparso negli anni)
if (cfg.limit > 0 && cfg.limit < recensioni.length) {
  const scelti = new Set(
    [...recensioni].sort((a, b) => a.ordine_hash.localeCompare(b.ordine_hash)).slice(0, cfg.limit).map((r) => r.review_id),
  );
  recensioni = recensioni.filter((r) => scelti.has(r.review_id));
}

// le informazioni sul file viaggiano sul primo elemento
recensioni[0] = { ...recensioni[0], _file: { righe_nel_file: righe.length, anomalie } };
return recensioni.map((r) => ({ json: r }));
