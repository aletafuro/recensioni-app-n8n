// AVVISO SE UN GIRO SI ROMPE
// Workflow di errore: n8n lo avvia da solo quando il workflow di analisi fallisce.
// Manda su Telegram il nome del nodo che si e' fermato e il messaggio di errore.
const token = $env.TELEGRAM_BOT_TOKEN, chat = $env.TELEGRAM_CHAT_ID;
const e = $input.first().json;
const testo = [
  'Attenzione: il giro di analisi delle recensioni si e\' fermato.',
  `Nodo: ${e.execution?.lastNodeExecuted ?? 'sconosciuto'}`,
  `Errore: ${String(e.execution?.error?.message ?? 'nessun messaggio').slice(0, 500)}`,
  `Esecuzione: ${e.execution?.id ?? '-'} (${e.execution?.mode ?? ''})`,
  'I risultati del giro precedente sono ancora in data/output.',
].join('\n');
if (!token || !chat) return [{ json: { inviato: false, motivo: 'Telegram non configurato', testo } }];
const r = await this.helpers.httpRequest({ method: 'POST', url: `https://api.telegram.org/bot${token}/sendMessage`, body: { chat_id: chat, text: testo }, json: true, timeout: 30000 });
return [{ json: { inviato: !!r.ok } }];
