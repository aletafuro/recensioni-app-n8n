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
const COLONNE = ['id_store', 'title', 'rating', 'travelDate', 'publishedDate', 'text', 'piattaforma', 'versione', 'paese'];
const visti = new Set(archivio.map((r) => `${r.piattaforma}|${r.id_store}`));
const nuove = scaricate.filter((r) => !visti.has(`${r.piattaforma}|${r.id_store}`));
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
    nuove_ios: nuove.filter((r) => r.piattaforma === 'ios').length,
    nuove_android: nuove.filter((r) => r.piattaforma === 'android').length,
    nuove: nuove.length,
    nuove_id_store: nuove.map((r) => `${r.piattaforma}|${r.id_store}`),
    recensioni_in_archivio_dopo: tutte.length,
  },
  binary: { data: { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv', fileName: cfg.input_file.split('/').pop() } },
}];
