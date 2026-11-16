// PROVA DEL NODO TELEGRAM FUORI DA n8n
// Esegue workflow/src/15_telegram.js con i risultati di un giro gia' fatto (cartella di uscita) e
// finge che TUTTE le recensioni del giro siano nuove, cosi' si vedono gli avvisi che partirebbero.
// Uso:  node strumenti/prova_avvisi_telegram.js data/prove/grappolo/output          (stampa soltanto)
//       node strumenti/prova_avvisi_telegram.js data/prove/grappolo/output invia    (manda davvero su Telegram,
//       preceduto da un messaggio che dice che e' una prova con dati inventati)
const fs = require('fs');
const path = require('path');

const [cartella, modo] = process.argv.slice(2);
if (!cartella) { console.error('manca la cartella dei risultati'); process.exit(1); }
const invia = modo === 'invia';
const leggi = (f) => JSON.parse(fs.readFileSync(path.join(cartella, f), 'utf8'));
const fileEnv = path.join(__dirname, '..', '.env'); // il .env e' facoltativo per le prove
const env = Object.fromEntries((fs.existsSync(fileEnv) ? fs.readFileSync(fileEnv, 'utf8') : '').split(/\r?\n/)
  .filter((r) => /^[A-Z0-9_]+=/.test(r)).map((r) => [r.slice(0, r.indexOf('=')), r.slice(r.indexOf('=') + 1).trim()]));

const aggregazione = leggi('aggregazione.json');
const chiavi = [...new Set((aggregazione.avviso_a_grappolo?.grappoli ?? []).flatMap((g) => g.recensioni.map((x) => x.chiave_store)))];
const nodi = {
  Configurazione: { output_dir: '/files/output', grappolo_giorni: Number(env.GRAPPOLO_GIORNI || 7) },
  Aggregazione: { aggregazione },
  'Fatti per il digest': { fatti: { frasi_piattaforme: [], frase_campagne: null } },
  'Verifica digest': { digest: '(prova)' },
  "Unisci con l'archivio": { nuove: chiavi.length, nuove_ios: null, nuove_android: null, nuove_id_store: chiavi },
};
const $ = (nome) => {
  if (nome === 'Usa digest di riserva') throw new Error('non eseguito');
  if (nome === 'Recensioni pronte' || nome === 'Valida e completa') return { all: () => [] }; // niente avvisi singoli qui
  return { first: () => ({ json: nodi[nome] }) };
};
const inviati = [];
const helpers = {
  async httpRequest(o) {
    inviati.push(o.body.text);
    if (!invia) return { ok: true };
    const r = await fetch(o.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.body) });
    return r.json();
  },
};

(async () => {
  const codice = fs.readFileSync(path.join(__dirname, '..', 'workflow', 'src', '15_telegram.js'), 'utf8');
  const nodo = new Function('$', '$env', 'Buffer', `return (async function () {\n${codice}\n}).call(this);`);
  if (invia) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: 'PROVA dell\'avviso a grappolo con recensioni INVENTATE (non sono recensioni vere). I messaggi che seguono sono quelli che arriverebbero.' }),
    });
  }
  // senza bot configurato si stampano comunque i messaggi (in modalita' «stampa» niente parte davvero)
  const segnaposto = invia ? {} : { TELEGRAM_BOT_TOKEN: 'solo-stampa', TELEGRAM_CHAT_ID: 'solo-stampa' };
  const out = await nodo.call({ helpers }, $, { ...segnaposto, ...(env.TELEGRAM_BOT_TOKEN ? { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID } : {}) }, Buffer);
  inviati.forEach((t, i) => console.log(`\n===== messaggio ${i + 1} =====\n${t}`));
  console.log('\nesito:', JSON.stringify({ ...out[0].json, esiti: out[0].json.esiti }, null, 1));
})();
