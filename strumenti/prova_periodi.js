// PROVA DEI CONFRONTI TRA PERIODI FUORI DA n8n
// Prende dal codice dell'Aggregazione le funzioni di calcolo e il blocco «periodi di calendario» e li esegue
// sulle recensioni di una tabella gia' prodotta (tabella_recensioni_aspetti.csv). Stampa il risultato in JSON.
// Uso: node strumenti/prova_periodi.js data/output [AAAA-MM-GG]
const fs = require('fs');
const path = require('path');
const [cartella, oggi] = process.argv.slice(2);
const src = fs.readFileSync(path.join(__dirname, '..', 'workflow', 'src', '08_aggregazione.js'), 'utf8').replace(/\r\n/g, '\n');
const pezzo = (inizio, fine) => {
  const a = src.indexOf(inizio), b = src.indexOf(fine, a);
  if (a < 0 || b < 0) throw new Error('pezzo non trovato: ' + inizio);
  return src.slice(a, b);
};
// lettura del CSV (campi tra virgolette con virgole e a capo)
function leggiCsv(t) {
  const righe = []; let campo = '', riga = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true; else if (c === ',') { riga.push(campo); campo = ''; }
    else if (c === '\n') { riga.push(campo); righe.push(riga); riga = []; campo = ''; } else if (c !== '\r') campo += c;
  }
  if (campo || riga.length) { riga.push(campo); righe.push(riga); }
  const [h, ...r] = righe;
  return r.map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]])));
}
const tab = leggiCsv(fs.readFileSync(path.join(cartella, 'tabella_recensioni_aspetti.csv'), 'utf8'));
const viste = new Map();
for (const r of tab) {
  if (r.nei_conteggi !== 'true' || viste.has(r.review_id)) continue;
  viste.set(r.review_id, { review_id: r.review_id, published_date: r.data_pubblicazione, rating: r.voto === '' ? null : Number(r.voto), overall_sentiment: r.sentiment_complessivo, piattaforma: r.piattaforma });
}
const valide = [...viste.values()];
const cfg = { grappolo_oggi: oggi ?? null };
const codice = [
  pezzo('const pct = ', 'function contaSentiment'),
  pezzo('function benjaminiHochberg', '\n}\n') + '\n}\n',
  pezzo('const MIN_RECENSIONI_CONFRONTO', 'const aggregazione = {'),
  'return periodiCalendario;',
].join('\n');
const risultato = new Function('cfg', 'valide', codice)(cfg, valide);
console.log(JSON.stringify(risultato, null, 1));
