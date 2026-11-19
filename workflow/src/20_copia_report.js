// COPIA DEI REPORT CON LA DATA (19/11)
// Il digest, l'Excel e il registro del giro hanno sempre lo stesso nome e ogni lunedi' vengono sovrascritti.
// Qui se ne fa una copia in output/giri/ con la data del giro davanti al nome (AAAA-MM-GG_digest.md, ora italiana),
// insieme ai messaggi mandati su Telegram: cosi' resta la storia di che cosa si e' detto ogni settimana.
// Niente sottocartelle: il nodo di scrittura di n8n non crea cartelle (verificato nel codice di n8n 2.29);
// la cartella giri/ la crea l'avvio del container. Per avere una cartella per data, o per portare i report su
// un disco condiviso, basta uno script fuori da n8n (per esempio con cron e rclone): cosi' un disco lento non ferma il giro.
const cfg = $('Configurazione').first().json;
const giorno = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(cfg.started_at));
const cartella = `${cfg.output_dir}/giri`;
const uscita = [];
const aggiungi = (nome, binario) => {
  if (binario?.data) uscita.push({ json: { path: `${cartella}/${giorno}_${nome}` }, binary: { data: { ...binario, fileName: nome } } });
};

// digest e registro del giro: dai file preparati per output/
let preparati = [];
try { preparati = $('Prepara file').all(); } catch (e) { preparati = []; }
for (const nome of ['digest.md', 'registro_giro.json']) aggiungi(nome, preparati.find((i) => i.binary?.data?.fileName === nome)?.binary.data);

// Excel
try { aggiungi('recensioni_app.xlsx', $('Prepara Excel').first().binary?.data); } catch (e) { /* Excel non preparato */ }

// messaggi mandati nel gruppo (riassunto, avvisi), nell'ordine in cui sono partiti
try {
  const esiti = $('Telegram: riassunto, digest e avvisi').first().json.esiti ?? [];
  const testi = esiti.filter((x) => x.testo).map((x) => (x.ok ? '' : '[NON INVIATO] ') + x.testo);
  if (testi.length) aggiungi('messaggi_telegram.txt', { data: Buffer.from(testi.join('\n\n----------\n\n') + '\n', 'utf8').toString('base64'), mimeType: 'text/plain' });
} catch (e) { /* Telegram non eseguito o non configurato */ }

return uscita;
