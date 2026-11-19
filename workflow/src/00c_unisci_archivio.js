// UNISCI CON L'ARCHIVIO
// L'archivio (il file di input) contiene tutte le recensioni scaricate finora. Si aggiungono solo
// quelle con un id_store mai visto: cosi' lo storico resta anche quando le recensioni escono dal feed,
// e si sa quali sono NUOVE in questo giro (servono per gli avvisi immediati).
const cfg = $('Configurazione').first().json;
// iOS (feed dell'App Store) + Android (API di Google Play, se configurata)
const ios = $('Scarica recensioni dallo store').first().json;
const android = $('Scarica recensioni Android').first().json;
const scaricate = [...ios.righe, ...android.righe];
let archivio = [];
try {
  archivio = $input.all().map((i) => i.json).filter((r) => r && r.id_store);
} catch (e) {
  archivio = [];
}
// autore: il nome nello store, solo per il foglio Recensioni dell'Excel (19/11); al modello non va
const COLONNE = ['id_store', 'title', 'rating', 'travelDate', 'publishedDate', 'text', 'piattaforma', 'versione', 'paese', 'autore'];
const visti = new Set(archivio.map((r) => `${r.piattaforma}|${r.id_store}`));
// iOS: feed pubblico e API di App Store Connect hanno identificativi DIVERSI per la stessa recensione. Si riconosce
// anche dal contenuto: paese, data, voto, titolo e inizio del testo (con il solo titolo due persone diverse che
// scrivono «Top» lo stesso giorno diventerebbero una: errore gia' visto il 14/11).
const norma = (s, n) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, n);
const contenuto = (r) => r.piattaforma === 'ios' ? `ios|${r.paese || 'it'}|${String(r.publishedDate).slice(0, 10)}|${r.rating}|${norma(r.title, 200)}|${norma(r.text, 80)}` : null;
const vistiContenuto = new Set(archivio.map(contenuto).filter(Boolean));
// una recensione arrivata due volte nello stesso giro (per esempio dall'API e dal report mensile) entra una volta sola
const nuove = scaricate.filter((r) => {
  const k = `${r.piattaforma}|${r.id_store}`, c = contenuto(r);
  if (visti.has(k) || (c && vistiContenuto.has(c))) return false;
  visti.add(k); if (c) vistiContenuto.add(c);
  return true;
});
// nome dell'autore alle recensioni gia' nell'archivio che non ce l'hanno: dalla stessa recensione scaricata in questo
// giro (stesso id, o per iOS stesso contenuto) e, per iOS, dai nomi di tutto lo storico letti dall'API.
// Per contenuto solo se la chiave e' di UNA recensione sola, sia tra le scaricate sia nell'archivio: due persone che
// scrivono la stessa cosa lo stesso giorno avrebbero lo stesso nome (verifica alla cieca: 2 coppie cosi').
// Meglio un nome vuoto che il nome di un altro.
const nomi = new Map();
const perContenuto = new Map();   // chiave di contenuto -> nomi visti (null se la chiave e' di piu' recensioni)
const idVisti = new Set();
for (const r of [...scaricate, ...(ios.autori ?? [])]) {
  const k = `${r.piattaforma}|${r.id_store}`, c = contenuto(r);
  if (idVisti.has(k)) continue;   // la stessa recensione letta due volte (feed e API hanno id diversi: qui conta l'id)
  idVisti.add(k);
  if (r.autore && !nomi.has(k)) nomi.set(k, r.autore);
  if (c) perContenuto.set(c, perContenuto.has(c) ? null : (r.autore || null));
}
const quanteNellArchivio = new Map();
for (const r of archivio) { const c = contenuto(r); if (c) quanteNellArchivio.set(c, (quanteNellArchivio.get(c) ?? 0) + 1); }
let autoriRiempiti = 0;
for (const r of archivio) {
  if (r.autore) continue;
  const c = contenuto(r);
  const n = nomi.get(`${r.piattaforma}|${r.id_store}`) ?? (c && quanteNellArchivio.get(c) === 1 ? perContenuto.get(c) : null);
  if (n) { r.autore = n; autoriRiempiti++; }
}
const tutte = [...nuove, ...archivio].map((r) => Object.fromEntries(COLONNE.map((c) => [c, r[c] ?? ''])));
// CSV con virgolette su ogni campo (testi con virgole, a capo e virgolette)
const campo = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const csv = [COLONNE.join(','), ...tutte.map((r) => COLONNE.map((c) => campo(r[c])).join(','))].join('\n') + '\n';
return [{
  json: {
    path: cfg.input_file,
    recensioni_in_archivio_prima: archivio.length,
    scaricate: scaricate.length,
    scaricate_ios: ios.righe.length,
    scaricate_android: android.righe.length,
    ios: ios.stato ?? 'ok',
    android: android.stato,
    android_storico: android.storico_stato ?? null,
    nuove_ios: nuove.filter((r) => r.piattaforma === 'ios').length,
    nuove_android: nuove.filter((r) => r.piattaforma === 'android').length,
    nuove: nuove.length,
    nuove_id_store: nuove.map((r) => `${r.piattaforma}|${r.id_store}`),
    recensioni_in_archivio_dopo: tutte.length,
    autori_aggiunti_all_archivio: autoriRiempiti,
    recensioni_con_autore: tutte.filter((r) => r.autore).length,
  },
  binary: { data: { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv', fileName: cfg.input_file.split('/').pop() } },
}];
