// SCARICA LE RECENSIONI DALLO STORE (feed pubblico dell'App Store)
// Il feed restituisce al massimo le 500 recensioni piu' recenti (10 pagine da 50).
// Ogni recensione ha un identificativo dello store (id_store): serve a non aggiungere due volte
// la stessa recensione all'archivio, e a riconoscere quelle NUOVE (per gli avvisi su Telegram).
// Gli autori non si salvano: all'analisi non servono.
// Google Play non ha un feed pubblico: per Android servono i report della Play Console.
const cfg = $('Configurazione').first().json;
const helpers = this.helpers;
if (!cfg.app_store_id) return [{ json: { scaricate: 0, pagine: [], righe: [], stato: 'non configurato: manca APP_STORE_ID' } }];
const righe = [];
const pagine = [];
for (let p = 1; p <= 10; p++) {
  const url = `https://itunes.apple.com/${cfg.store_paese}/rss/customerreviews/page=${p}/id=${cfg.app_store_id}/sortby=mostrecent/json`;
  let dati;
  try {
    dati = await helpers.httpRequest({ method: 'GET', url, json: true, timeout: 30000 });
  } catch (e) {
    pagine.push({ pagina: p, errore: e.message });
    break;
  }
  if (typeof dati === 'string') dati = JSON.parse(dati);
  const voci = [].concat(dati?.feed?.entry ?? []).filter((e) => e['im:rating']);
  pagine.push({ pagina: p, recensioni: voci.length });
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
      paese: cfg.store_paese,
    });
  }
}
if (!righe.length) throw new Error('Nessuna recensione scaricata dallo store: ' + JSON.stringify(pagine));
return [{ json: { scaricate: righe.length, pagine, righe } }];
