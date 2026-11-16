// PROVA DEL NODO ANDROID FUORI DA n8n (workflow/src/00d_scarica_android.js)
// Uso:
//   node strumenti/prova_android.js vero    -> Google vero: API delle recensioni e report mensili (credenziali dal .env)
//   node strumenti/prova_android.js finto   -> Google vero per l'accesso e l'API, ma i report mensili sono sostituiti
//                                              da un report FINTO nel formato della Play Console (UTF-16)
// Stampa lo stato, le righe ottenute (senza testi lunghi) e i controlli sul report finto. Non scrive niente.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modo = process.argv[2] || 'vero';
const fileEnv = path.join(__dirname, '..', '.env'); // il .env e' facoltativo per le prove
const env = Object.fromEntries((fs.existsSync(fileEnv) ? fs.readFileSync(fileEnv, 'utf8') : '').split(/\r?\n/)
  .filter((r) => /^[A-Z0-9_]+=/.test(r)).map((r) => [r.slice(0, r.indexOf('=')), r.slice(r.indexOf('=') + 1).trim()]));
const cfg = {
  play_package: env.GOOGLE_PLAY_PACKAGE, play_lingue: (env.PLAY_LINGUE || 'it').split(',').map((x) => x.trim()),
  play_bucket: String(env.GOOGLE_PLAY_BUCKET || '').replace(/^gs:\/\//, '').split('/')[0],
};

// report finto: intestazioni della Play Console, 5 righe con i casi da provare
const INTEST = ['Package Name', 'App Version Code', 'App Version Name', 'Reviewer Language', 'Device', 'Review Submit Date and Time', 'Review Submit Millis Since Epoch',
  'Review Last Update Date and Time', 'Review Last Update Millis Since Epoch', 'Star Rating', 'Review Title', 'Review Text', 'Developer Reply Date and Time',
  'Developer Reply Millis Since Epoch', 'Developer Reply Text', 'Review Link'];
const riga = (o) => INTEST.map((k) => `"${String(o[k] ?? '').replace(/"/g, '""')}"`).join(',');
const FINTE = [
  { 'App Version Name': '3.1.2', 'Reviewer Language': 'it', 'Review Submit Millis Since Epoch': '1696118400000', 'Review Last Update Millis Since Epoch': '1696204800000', 'Star Rating': '1', 'Review Text': 'Ho pagato, i crediti non sono arrivati. "Vergogna", dico io', 'Review Link': 'http://play.google.com/console/developers/x/app/y/user-feedback/review-details?reviewid=finto-1&corpus=PUBLIC_REVIEWS' },
  { 'App Version Name': '3.1.2', 'Reviewer Language': 'en', 'Review Submit Millis Since Epoch': '1696118400000', 'Star Rating': '5', 'Review Text': 'Great app', 'Review Link': 'http://x?reviewid=finto-2' },
  { 'App Version Name': '3.1.2', 'Reviewer Language': 'it', 'Review Submit Millis Since Epoch': '1696118400000', 'Star Rating': '4', 'Review Text': '', 'Review Link': 'http://x?reviewid=finto-3' },
  { 'App Version Name': '3.2.0', 'Reviewer Language': 'it', 'Review Submit Millis Since Epoch': '1698796800000', 'Star Rating': '2', 'Review Title': 'Titolo', 'Review Text': 'Riga uno,\nriga due con virgola, e a capo', 'Review Link': '' },
  { 'App Version Name': '3.2.0', 'Reviewer Language': 'it-IT', 'Review Submit Millis Since Epoch': '1698796800000', 'Star Rating': '3', 'Review Text': 'Ripetuta nel secondo file', 'Review Link': 'http://x?reviewid=finto-5' },
];
const utf16 = (t) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);
const fileFinti = {
  [`reviews/reviews_${cfg.play_package}_202310.csv`]: utf16([INTEST.join(','), ...FINTE.slice(0, 3).map(riga)].join('\n') + '\n'),
  [`reviews/reviews_${cfg.play_package}_202311.csv`]: utf16([INTEST.join(','), ...FINTE.slice(3).map(riga), riga(FINTE[4])].join('\r\n') + '\r\n'),
};

const helpers = {
  async httpRequest(o) {
    if (modo === 'finto' && o.url.startsWith('https://storage.googleapis.com/')) {
      if (o.url.includes('/o?prefix=')) return { items: Object.keys(fileFinti).map((name) => ({ name })) };
      const nome = decodeURIComponent(o.url.split('/o/')[1].split('?')[0]);
      return fileFinti[nome];
    }
    const r = await fetch(o.url, { method: o.method, headers: o.headers, body: o.body });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`); e.httpCode = String(r.status); throw e; }
    if (o.encoding === 'arraybuffer') return Buffer.from(await r.arrayBuffer());
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  },
};
const $ = (n) => ({ first: () => ({ json: { Configurazione: cfg }[n] }) });
const require2 = (m) => (m === 'crypto' ? crypto : require(m));

(async () => {
  const codice = fs.readFileSync(path.join(__dirname, '..', 'workflow', 'src', '00d_scarica_android.js'), 'utf8');
  const nodo = new Function('$', '$env', 'Buffer', 'require', `return (async function () {\n${codice}\n}).call(this);`);
  const [{ json: out }] = await nodo.call({ helpers }, $, env, Buffer, require2);
  console.log('stato API:', out.stato, '| pagine:', out.pagine);
  console.log('stato storico:', out.storico_stato, '| file:', out.storico_file, '| righe dai report:', out.storico_righe);
  console.log('righe totali (dopo aver tolto i doppioni):', out.righe.length);
  for (const r of out.righe) console.log('  ', r.id_store.slice(0, 24), r.publishedDate, r.rating, r.versione, r.paese, JSON.stringify((r.title ? r.title + ' | ' : '') + r.text.slice(0, 50)));
  if (modo === 'finto') {
    const f = out.righe.filter((r) => /^finto|^pc:/.test(r.id_store));
    const ok = [
      ['finto-1 tenuta, data di ultima modifica 2023-10-02, virgolette conservate', f.some((r) => r.id_store === 'finto-1' && r.publishedDate === '2023-10-02' && r.text.includes('"Vergogna"'))],
      ['finto-2 (inglese) scartata', !f.some((r) => r.id_store === 'finto-2')],
      ['finto-3 (senza testo) scartata', !f.some((r) => r.id_store === 'finto-3')],
      ['senza link: identificativo pc:..., a capo e virgole nel testo', f.some((r) => r.id_store.startsWith('pc:') && r.text.includes('\n') && r.title === 'Titolo')],
      ['finto-5 (lingua it-IT) tenuta una volta sola anche se ripetuta', f.filter((r) => r.id_store === 'finto-5').length === 1],
      ['righe dai report = 4 (prima di togliere i doppioni)', out.storico_righe === 4],
    ];
    for (const [k, v] of ok) console.log(v ? 'OK ' : 'NO ', k);
  }
})();
