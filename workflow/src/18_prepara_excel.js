// PREPARA IL FILE EXCEL (recensioni_app.xlsx)
// Tabelle da aprire in Excel (o Tableau) per chi gestisce l'app, con i confronti tra periodi (mese per mese e ogni due settimane). Un solo file con piu' fogli, scritto accanto agli
// altri risultati e mandato su Telegram dopo il digest.
// Nessun numero nuovo: tutto viene dall'Aggregazione (periodi, confronti, grappoli) o e' un semplice conteggio
// delle analisi delle recensioni. Il file .xlsx e' costruito a mano (zip senza compressione + XML), perche' nel
// nodo Code non ci sono librerie esterne.
const cfg = $('Configurazione').first().json;
const A = $('Aggregazione').first().json.aggregazione;
const tax = $('Valida tassonomia').first().json;
const analisi = $('Valida e completa').all().map((i) => i.json);
const pronte = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));

const nomeAspetto = Object.fromEntries([...(A.aspetti ?? []).map((a) => [a.aspect, a.nome]), ...tax.aspetti.map((a) => [a.aspect, a.nome])]);
const SENT = { positive: 'positivo', negative: 'negativo', mixed: 'misto', neutral: 'neutro' };
const PF = { ios: 'iOS', android: 'Android', tutte: 'tutte' };
const MISURA = { pct_recensioni_che_lo_criticano: '% recensioni che lo criticano', pct_recensioni_che_lo_apprezzano: '% recensioni che lo apprezzano' };
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const media = (xs) => (xs.length ? Math.round((100 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 100 : null);
const siNo = (x) => (x === true ? 'sì' : x === false ? 'no' : '');
const valide = analisi.filter((r) => (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta);

// --- fogli: ognuno e' { nome, colonne, righe (array di array) }
const fogli = [];

const R = A.periodi_di_calendario;
fogli.push({
  nome: 'Leggimi',
  colonne: ['foglio', 'che cosa contiene'],
  righe: [
    ['Due settimane', 'Per ogni periodo di due settimane (da lunedì a domenica): recensioni, voto medio, sentiment e confronto con le due settimane prima.'],
    ['Mesi', 'Lo stesso, mese per mese.'],
    ['Confronti', 'Temi: ultimo periodo contro i precedenti e ultima versione dell\'app contro le precedenti (solo con abbastanza recensioni).'],
    ['Temi per mese', 'Per ogni mese e tema: quante recensioni lo apprezzano e quante lo criticano.'],
    ['Versioni', 'Recensioni per versione dell\'app, con la quota di negative.'],
    ['Lingue', 'Recensioni per lingua, con la quota di negative.'],
    ['Segnalazioni', 'Le recensioni da guardare: categoria, priorità, che cosa dice l\'utente e la sua frase.'],
    ['Grappoli', 'Avvisi a grappolo: stesso problema, stessa piattaforma e versione, in pochi giorni.'],
    ['Recensioni', 'Una riga per recensione: dati, sentiment, temi, segnalazioni, testo.'],
    ['', ''],
    ['Come leggere i confronti', '«oltre il rumore» = la differenza è troppo grande per essere un caso (test su due proporzioni con correzione per i confronti multipli). «entro il rumore» = può essere un caso. «pochi dati» = uno dei due periodi ha meno di 20 recensioni: si vedono i numeri ma non si dà un verdetto.'],
    ['p-value e verdetto', 'Un p-value sotto 0,05 può restare «entro il rumore»: con tanti confronti nella stessa tabella qualcuno risulta basso per caso, e la correzione alza la soglia (Benjamini-Hochberg, al massimo 10% di falsi allarmi attesi). Conta la colonna «confronto».'],
    ['Periodo in corso', 'Il mese e le due settimane in corso non sono finiti: i loro numeri cresceranno. La colonna «nota» lo dice, e dice anche quando il primo periodo è incompleto perché i dati partono a metà.'],
    ['iOS e Android', 'Sempre separati: le due piattaforme hanno versioni e storici diversi. Solo il foglio Confronti (periodi) le considera insieme, come il digest.'],
    ['Attenzione', 'Le recensioni sono affermazioni degli utenti, non fatti accertati.'],
    ['Regola dei periodi', R?.regola ?? ''],
    ['Regola dei grappoli', A.avviso_a_grappolo?.regola ?? ''],
    ['Giro del', new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })],
  ],
});

const righePeriodi = (serie) => serie.flatMap((s) => s.periodi.map((p) => [
  PF[s.piattaforma] ?? s.piattaforma, p.periodo, p.in_corso ? 'in corso: incompleto' : p.dati_solo_dal ? `incompleto: dati solo dal ${p.dati_solo_dal}` : '', p.recensioni, p.voto_medio, p.positive, p.negative, p.miste, p.neutre,
  p.pct_negative, p.confronto?.pct_negative_prima ?? null, p.confronto?.differenza_punti ?? null, p.confronto?.esito ?? '', p.confronto?.p_value ?? null,
]));
const colPeriodi = ['piattaforma', 'periodo', 'nota', 'recensioni', 'voto medio', 'positive', 'negative', 'miste', 'neutre', '% negative', '% negative periodo prima', 'differenza (punti)', 'confronto', 'p-value'];
fogli.push({ nome: 'Due settimane', colonne: colPeriodi, righe: righePeriodi(R?.due_settimane ?? []) });
fogli.push({ nome: 'Mesi', colonne: colPeriodi, righe: righePeriodi(R?.mesi ?? []) });

const confronti = [
  ...(A.andamento ?? []).map((x) => ['iOS e Android insieme', 'periodo', `${x.ultimo_periodo} contro ${x.periodo_di_confronto}`, x.nome, MISURA[x.misura] ?? x.misura, x.valore_ultimo_periodo, x.valore_periodo_di_confronto, x.differenza_punti, x.p_value, x.significativo ? 'oltre il rumore' : 'entro il rumore']),
  ...(A.per_piattaforma ?? []).flatMap((p) => (p.andamento_ultima_versione ?? []).map((x) => [PF[p.piattaforma] ?? p.piattaforma, 'versione', `${x.ultima_versione} contro ${x.confrontata_con}`, x.nome, MISURA[x.misura] ?? x.misura, x.valore_nuovo, x.valore_confronto, x.differenza_punti, x.p_value, x.significativo ? 'oltre il rumore' : 'entro il rumore'])),
];
fogli.push({ nome: 'Confronti', colonne: ['piattaforma', 'tipo', 'confronto', 'tema', 'misura', 'valore nuovo', 'valore di confronto', 'differenza (punti)', 'p-value', 'esito'], righe: confronti });

// temi per mese (conteggi semplici sulle recensioni nei conteggi)
const temiMese = new Map();
const recMese = new Map();
for (const r of valide) {
  if (!r.published_date) continue;
  const m = String(r.published_date).slice(0, 7);
  for (const pf of [r.piattaforma ?? 'non indicata']) {
    recMese.set(`${pf}|${m}`, (recMese.get(`${pf}|${m}`) ?? 0) + 1);
    for (const a of r.aspects ?? []) {
      const k = `${pf}|${m}|${a.aspect}`;
      const x = temiMese.get(k) ?? { pf, m, aspect: a.aspect, pos: 0, neg: 0 };
      if (a.sentiment === 'positive') x.pos++;
      if (a.sentiment === 'negative') x.neg++;
      temiMese.set(k, x);
    }
  }
}
fogli.push({
  nome: 'Temi per mese',
  colonne: ['piattaforma', 'mese', 'tema', 'recensioni del mese', 'lo apprezzano', 'lo criticano', '% che lo criticano'],
  righe: [...temiMese.values()].sort((a, b) => a.pf.localeCompare(b.pf) || a.m.localeCompare(b.m) || b.neg - a.neg)
    .map((x) => { const n = recMese.get(`${x.pf}|${x.m}`); return [PF[x.pf] ?? x.pf, x.m, nomeAspetto[x.aspect] ?? x.aspect, n, x.pos, x.neg, pct(x.neg, n)]; }),
});

const ordineVersione = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return String(a).localeCompare(String(b));
    if (x !== y) return x - y;
  }
  return 0;
};
const raggruppa = (chiave) => {
  const g = new Map();
  for (const r of valide) { const k = chiave(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return g;
};
const versioni = raggruppa((r) => `${r.piattaforma ?? 'non indicata'}|${r.versione || ''}`);
const piuRecente = {};
for (const k of versioni.keys()) { const [pf, v] = k.split('|'); if (v && (!piuRecente[pf] || ordineVersione(v, piuRecente[pf]) > 0)) piuRecente[pf] = v; }
fogli.push({
  nome: 'Versioni',
  colonne: ['piattaforma', 'versione', 'la più recente vista', 'recensioni', 'voto medio', 'negative', '% negative', 'prima recensione', 'ultima recensione'],
  righe: [...versioni.entries()].map(([k, l]) => {
    const [pf, v] = k.split('|');
    const d = l.map((r) => r.published_date).filter(Boolean).sort();
    const neg = l.filter((r) => r.overall_sentiment === 'negative').length;
    return [PF[pf] ?? pf, v || 'non indicata', v && v === piuRecente[pf] ? 'sì' : '', l.length, media(l.filter((r) => r.rating !== null).map((r) => r.rating)), neg, pct(neg, l.length), d[0] ?? '', d[d.length - 1] ?? ''];
  }).sort((a, b) => a[0].localeCompare(b[0]) || (a[1] === 'non indicata') - (b[1] === 'non indicata') || ordineVersione(b[1], a[1])),
});

const lingue = raggruppa((r) => `${r.piattaforma ?? 'non indicata'}|${r.language}`);
fogli.push({
  nome: 'Lingue',
  colonne: ['piattaforma', 'lingua', 'recensioni', 'negative', '% negative'],
  righe: [...lingue.entries()].map(([k, l]) => { const [pf, lg] = k.split('|'); const neg = l.filter((r) => r.overall_sentiment === 'negative').length; return [PF[pf] ?? pf, lg === 'und' ? 'non riconosciuta' : lg, l.length, neg, pct(neg, l.length)]; })
    .sort((a, b) => a[0].localeCompare(b[0]) || b[2] - a[2]),
});

const segnalazioni = analisi.flatMap((r) => (r.segnalazioni ?? []).map((s) => [r.published_date ?? '', PF[r.piattaforma] ?? r.piattaforma ?? '', r.versione || '', r.rating, s.nome_categoria, s.priorita, s.sintesi, s.evidenza, r.review_id]))
  .sort((a, b) => String(b[0]).localeCompare(String(a[0])));
fogli.push({ nome: 'Segnalazioni', colonne: ['data', 'piattaforma', 'versione', 'voto', 'categoria', 'priorità', 'secondo l\'utente', 'frase della recensione', 'review_id'], righe: segnalazioni });

fogli.push({
  nome: 'Grappoli',
  colonne: ['piattaforma', 'versione', 'la più recente vista', 'problema', 'recensioni nel grappolo', 'data', 'voto', 'frase della recensione', 'review_id'],
  righe: (A.avviso_a_grappolo?.grappoli ?? []).flatMap((g) => g.recensioni.map((x) => [PF[g.piattaforma] ?? g.piattaforma, g.versione ?? 'non indicata', siNo(g.e_la_versione_piu_recente), g.nome_categoria, g.quante, x.data, x.voto, x.evidenza, x.review_id])),
});

fogli.push({
  nome: 'Recensioni',
  colonne: ['data', 'piattaforma', 'versione', 'lingua', 'voto', 'sentiment', 'temi (giudizio)', 'segnalazioni', 'nei conteggi', 'titolo', 'testo', 'review_id'],
  righe: analisi.map((r) => {
    const p = pronte.get(r.review_id) ?? {};
    return [
      r.published_date ?? '', PF[r.piattaforma] ?? r.piattaforma ?? '', r.versione || '', r.language === 'und' ? '' : r.language, r.rating, SENT[r.overall_sentiment] ?? r.overall_sentiment,
      (r.aspects ?? []).map((a) => `${nomeAspetto[a.aspect] ?? a.aspect}: ${SENT[a.sentiment] ?? a.sentiment}`).join('; '),
      [...new Set((r.segnalazioni ?? []).map((s) => s.nome_categoria))].join('; '),
      (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta ? 'sì' : 'no',
      p.title ?? '', p.text ?? '', r.review_id,
    ];
  }).sort((a, b) => String(b[0]).localeCompare(String(a[0]))),
});

// --- costruzione del file .xlsx
const xml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').slice(0, 32000)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colonna = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const cella = (v, rif, stile) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${rif}"${stile}><v>${v}</v></c>`;
  return `<c r="${rif}" t="inlineStr"${stile}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
};
const foglioXml = (f) => {
  const tutte = [f.colonne, ...f.righe];
  const larghezze = f.colonne.map((c, j) => Math.min(60, Math.max(10, ...tutte.slice(0, 200).map((r) => String(r[j] ?? '').length + 2))));
  const righe = tutte.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cella(v, `${colonna(j)}${i + 1}`, i === 0 ? ' s="1"' : '')).join('')}</row>`).join('');
  const ultima = `${colonna(f.colonne.length - 1)}${Math.max(1, tutte.length)}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${larghezze.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${righe}</sheetData>`
    + (f.righe.length ? `<autoFilter ref="A1:${ultima}"/>` : '')
    + '</worksheet>';
};
const file = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + fogli.map((f, i) => `<sheet name="${xml(f.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets>'
    + `<definedNames>${fogli.map((f, i) => (f.righe.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(f.nome)}'!$A$1:$${colonna(f.colonne.length - 1)}$${f.righe.length + 1}</definedName>` : '')).join('')}</definedNames>`
    + '</workbook>',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
};
fogli.forEach((f, i) => { file[`xl/worksheets/sheet${i + 1}.xml`] = foglioXml(f); });

// zip senza compressione (metodo «stored»), con CRC-32
const TABELLA_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABELLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locali = [], centrali = [];
let posizione = 0;
for (const [nome, testo] of Object.entries(file)) {
  const n = Buffer.from(nome, 'utf8'), d = Buffer.from(testo, 'utf8'), crc = crc32(d);
  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(0, 8);
  loc.writeUInt16LE(0, 10); loc.writeUInt16LE(0x21, 12); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(d.length, 18); loc.writeUInt32LE(d.length, 22);
  loc.writeUInt16LE(n.length, 26); loc.writeUInt16LE(0, 28);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
  cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(d.length, 20); cen.writeUInt32LE(d.length, 24);
  cen.writeUInt16LE(n.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36);
  cen.writeUInt32LE(0, 38); cen.writeUInt32LE(posizione, 42);
  locali.push(loc, n, d); centrali.push(cen, n);
  posizione += loc.length + n.length + d.length;
}
const dirCentrale = Buffer.concat(centrali);
const fine = Buffer.alloc(22);
fine.writeUInt32LE(0x06054b50, 0); fine.writeUInt16LE(0, 4); fine.writeUInt16LE(0, 6);
fine.writeUInt16LE(Object.keys(file).length, 8); fine.writeUInt16LE(Object.keys(file).length, 10);
fine.writeUInt32LE(dirCentrale.length, 12); fine.writeUInt32LE(posizione, 16); fine.writeUInt16LE(0, 20);
const xlsx = Buffer.concat([...locali, dirCentrale, fine]);

// su Telegram solo nel giro ufficiale (stesse regole del riassunto) e se il bot e' configurato
const inviaTelegram = !!($env.TELEGRAM_BOT_TOKEN && $env.TELEGRAM_CHAT_ID)
  && (cfg.output_dir === '/files/output' || String($env.TELEGRAM_ANCHE_PROVE || '').toLowerCase() === 'true');
return [{
  json: { path: `${cfg.output_dir}/recensioni_app.xlsx`, invia_telegram: inviaTelegram, fogli: fogli.map((f) => ({ nome: f.nome, righe: f.righe.length })), byte: xlsx.length },
  binary: { data: { data: xlsx.toString('base64'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: 'recensioni_app.xlsx' } },
}];
