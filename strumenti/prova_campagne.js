// PROVA DEL CONTROLLO DELLE CAMPAGNE FUORI DA n8n
// Prende dal codice dell'Aggregazione il blocco «controllo delle campagne coordinate» e lo esegue sull'archivio
// (data/input/recensioni_inventate.csv), con le stesse esclusioni del workflow (stesso id dello store, recensioni vuote).
// Serve a confrontarlo con workflow/controlla_campagne.py, scritto in Python in modo indipendente.
// Uso: node strumenti/prova_campagne.js
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(A, 'workflow', 'src', '08_aggregazione.js'), 'utf8').replace(/\r\n/g, '\n');
const inizio = src.indexOf('const campagne = (() => {');
const fine = src.indexOf('\n})();\n', inizio) + '\n})();\n'.length;
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
const visti = new Set();
const pronte = [];
for (const r of leggiCsv(fs.readFileSync(path.join(A, 'data', 'input', 'recensioni_inventate.csv'), 'utf8'))) {
  if (visti.has(r.id_store)) continue;
  visti.add(r.id_store);
  if (!r.text.trim() && !r.title.trim()) continue;
  pronte.push({ review_id: r.id_store, title: r.title, text: r.text, rating: r.rating === '' ? null : Number(r.rating), published_date: r.publishedDate, piattaforma: r.piattaforma, duplicato_di: null, vuota: false });
}
const $ = () => ({ all: () => pronte.map((json) => ({ json })) });
const ctx = { voto: { minimo: 1 } };
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const c = new Function('$', 'ctx', 'pct', src.slice(inizio, fine) + '\nreturn campagne;')($, ctx, pct);
console.log(JSON.stringify({ recensioni_controllate: c.recensioni_controllate, giorni_controllati: c.giorni_controllati, testi_quasi_identici: c.testi_quasi_identici.length, picchi: c.picchi_una_stella.map((p) => [p.piattaforma, p.data, p.una_stella, p.attese_una_stella]), vicini: c.giorni_piu_vicini_alla_soglia, esito: c.esito }, null, 1));
