// Crea, dentro il container, la credenziale OpenAI che n8n usa nei nodi HTTP
// e nei guardrail. La chiave arriva dalla variabile d'ambiente OPENAI_API_KEY
// (file .env): non e' mai scritta nel workflow ne' nella cartella del progetto.
// Il file temporaneo viene cancellato subito dopo l'importazione.
const fs = require('fs');

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY mancante: copia .env.example in .env e inserisci la chiave');
  process.exit(1);
}
const credenziale = [{
  id: 'openaiRecensApp',
  name: 'OpenAI (da .env)',
  type: 'openAiApi',
  data: {
    apiKey: process.env.OPENAI_API_KEY,
    url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },
}];
// credenziale del bot Telegram: token dal file .env, come la chiave OpenAI. Si crea SEMPRE, anche senza token,
// perche' il nodo Telegram del workflow la richiede per partire (senza, n8n non avvia il giro: «No active
// execution found»). Senza token il nodo non viene mai eseguito: lo ferma il controllo «Telegram configurato?».
credenziale.push({ id: 'telegramRecensApp', name: 'Telegram (da .env)', type: 'telegramApi', data: { accessToken: process.env.TELEGRAM_BOT_TOKEN || 'non-configurato' } });
fs.writeFileSync('/tmp/credenziale.json', JSON.stringify(credenziale), { mode: 0o600 });
