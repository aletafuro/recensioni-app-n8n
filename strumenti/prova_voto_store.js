// PROVA DEL NODO «VOTO NEGLI STORE» FUORI DA n8n (workflow/src/19_voto_store.js)
// Legge davvero Apple (voto per paese) e i report di Google (voto per paese, giorno per giorno) con le credenziali
// del .env, e stampa il risultato. Non manda niente.
// Uso: node strumenti/prova_voto_store.js [cartella_storico] [AAAA-MM-GG]
//   cartella_storico: dove leggere storico_voti.json (predefinita data/output); con «scrivi» come terzo argomento
//   salva lo storico aggiornato in quella cartella.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [cartella = path.join(__dirname, '..', 'data', 'output'), oggi, scrivi] = process.argv.slice(2);
const fileEnv = path.join(__dirname, '..', '.env');
const env = Object.fromEntries((fs.existsSync(fileEnv) ? fs.readFileSync(fileEnv, 'utf8') : '').split(/\r?\n/)
  .filter((r) => /^[A-Z0-9_]+=/.test(r)).map((r) => [r.slice(0, r.indexOf('=')), r.slice(r.indexOf('=') + 1).trim()]));
// per le prove si puo' sostituire una voce del .env dalla riga di comando (per esempio un indirizzo dei report sbagliato)
for (const k of ['GOOGLE_PLAY_BUCKET']) if (process.env[k]) env[k] = process.env[k];
const cfg = {
  app_store_id: env.APP_STORE_ID || '', play_package: env.GOOGLE_PLAY_PACKAGE, voto_paesi: (env.VOTO_PAESI || 'it,gb,us').split(','),
  play_bucket: String(env.GOOGLE_PLAY_BUCKET || '').replace(/^gs:\/\//, '').split('/')[0], output_dir: '/files/output', grappolo_oggi: oggi || null,
};
const fileStorico = path.join(cartella, 'storico_voti.json');
const storico = fs.existsSync(fileStorico) ? JSON.parse(fs.readFileSync(fileStorico, 'utf8')) : null;
const helpers = {
  async httpRequest(o) {
    const r = await fetch(o.url, { method: o.method, headers: o.headers, body: o.body });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.httpCode = String(r.status); throw e; }
    if (o.encoding === 'arraybuffer') return Buffer.from(await r.arrayBuffer());
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  },
};
const $ = (n) => ({ first: () => ({ json: n === 'Configurazione' ? cfg : { data: storico } }) });
(async () => {
  const codice = fs.readFileSync(path.join(__dirname, '..', 'workflow', 'src', '19_voto_store.js'), 'utf8');
  const nodo = new Function('$', '$env', 'Buffer', 'require', `return (async function () {\n${codice}\n}).call(this);`);
  const [{ json, binary }] = await nodo.call({ helpers }, $, env, Buffer, (m) => (m === 'crypto' ? crypto : require(m)));
  const v = json.voto_store;
  console.log('oggi', v.oggi, '| iOS:', v.ios.stato, '| Android:', v.android.stato, '| report Android letti:', v.android.report_letti);
  for (const p of v.ios.paesi) console.log('  iOS', p.nome, p.stato, p.voto, p.valutazioni, 'prima', p.voto_prima ?? '-', p.valutazioni_prima ?? '-', 'nuovi', p.voti_nuovi ?? '-', 'media nuovi', p.media_voti_nuovi ?? p.media_voti_nuovi_nota ?? '-');
  for (const p of v.android.paesi) console.log('  Android', p.nome, p.stato, p.voto, 'al', p.dati_fino_al, '| prima', p.voto_prima, 'al', p.data_prima);
  console.log('  serie settimanale Android:', v.android.serie_settimanale.length, 'punti; ultimi:', JSON.stringify(v.android.serie_settimanale.slice(-3)));
  console.log('  istantanee iOS nello storico:', v.istantanee_ios.length);
  if (scrivi === 'scrivi') {
    fs.writeFileSync(fileStorico, Buffer.from(binary.data.data, 'base64'));
    console.log('storico scritto in', fileStorico);
  }
})();
