// VERIFICA E COMPOSIZIONE DEL DIGEST
// Il digest lo monta il CODICE: titoli, frasi con i numeri (scritte nel nodo dei
// fatti), elenchi, recensioni da guardare. Dal modello arrivano solo i commenti a
// parole, sezione per sezione, e le citazioni. Cosi' ogni numero del digest e'
// scritto dal codice, per costruzione, e non puo' cambiare significato.
// Controlli sulla parte del modello:
// - nei commenti nessuna cifra e nessuna virgoletta « »;
// - ogni citazione copiata parola per parola dalla recensione indicata;
// - identificativi esistenti e almeno una citazione per le sezioni principali.
// - affermazioni a parole coerenti con i fatti (divisivi, critiche in aumento, apprezzamento in calo):
//   vedi controllaAffermazioni piu' sotto (aggiunto il 14/11 dopo la revisione del digest dell'hotel).
// Se un controllo fallisce, il modello riceve i problemi e corregge (fino a 2 volte).
// Se non basta, il digest esce senza i commenti del modello (versione di riserva).
const helpers = this.helpers;
const usoToken = []; // token delle correzioni del digest
const cfg = $('Configurazione').first().json;
const { fatti, body } = $('Fatti per il digest').first().json;
const testi = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json.title + '\n' + i.json.text]));

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”„"]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
const maiusc = (s) => String(s).replace(/^./, (c) => c.toUpperCase());
const SEZIONI = ['apprezzati', 'criticati', 'segnalate'];
const COMMENTI = ['sintesi', 'commento_apprezzati', 'commento_criticati', 'commento_tempo', 'commento_segnalate'];

function leggi(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// >>> CONTROLLO AFFERMAZIONI (inizio)
// Controllo dei commenti contro i fatti. Il modello non scrive numeri, ma puo' scrivere affermazioni
// sbagliate a parole (nel digest dell'hotel: «divisivi» per aspetti che non lo sono, «aumentano le
// critiche» dove i numeri mostrano solo un calo dei giudizi positivi). Per ogni frase dei commenti:
// - se dice «divisivo», ogni aspetto nominato deve essere tra i piu' divisivi;
// - se dice che le critiche (lamentele, giudizi negativi) aumentano, ogni aspetto nominato deve avere
//   un aumento significativo della quota di recensioni che lo criticano;
// - se dice che l'apprezzamento (soddisfazione, giudizi positivi) cala, ogni aspetto nominato deve
//   avere un calo significativo della quota di recensioni che lo apprezzano.
// Gli aspetti si riconoscono dalle parole del loro nome (radici di almeno 4 lettere, senza parole generiche).
function controllaAffermazioni(o, A) {
  const problemi = [];
  if (!o || !A) return problemi;
  // parole che compaiono in quasi ogni commento e non identificano un aspetto (es. «aspetti divisivi» non e' l'aspetto «Design e aspetto»)
  const GENERICHE = new Set(['dell', 'della', 'delle', 'degli', 'dello', 'sulla', 'nella', 'app', 'utenti', 'utente', 'generale', 'altri', 'altre', 'aspetto', 'aspetti', 'recensioni', 'recensione', 'esperienza']);
  const radice = (w) => w.slice(0, Math.min(w.length, 6));
  const parole = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
  const aspetti = A.aspetti.map((a) => ({ nome: a.nome, chiavi: [...new Set(parole(a.nome).filter((w) => w.length >= 4 && !GENERICHE.has(w)).map(radice))] }));
  const sig = (misura, direzione) => new Set(A.andamento.filter((x) => x.significativo && x.misura === misura && x.direzione === direzione).map((x) => x.nome));
  const critAumento = sig('pct_recensioni_che_lo_criticano', 'aumento');
  const apprCalo = sig('pct_recensioni_che_lo_apprezzano', 'calo');
  const divisivi = new Set((A.classifiche.piu_criticati_per_tasso ?? []).filter((x) => x.pct_negative_su_menzioni >= 30).slice(0, 3).map((x) => x.nome));
  const regole = [
    // «meno divisivo» / «non divisivo» non e' un'affermazione di divisivita'
    { dice: (f) => /divisiv/.test(f) && !/(meno|non|poco) (molto )?divisiv/.test(f), vale: (n) => divisivi.has(n), cosa: "e' tra gli aspetti piu' divisivi" },
    // solo verbi di aumento: «la maggior parte» o «in piu'» non dicono che qualcosa e' aumentato
    { dice: (f) => /(aument|cresc)/.test(f) && /(critic|lament|negativ|insoddisf)/.test(f), vale: (n) => critAumento.has(n), cosa: 'ha un aumento significativo delle critiche' },
    { dice: (f) => /(calo|cala|calat|diminu|scend|ridott|peggior)/.test(f) && /(apprezz|soddisf|positiv|gradiment)/.test(f), vale: (n) => apprCalo.has(n), cosa: "ha un calo significativo dell'apprezzamento" },
  ];
  for (const campo of ['sintesi', 'commento_apprezzati', 'commento_criticati', 'commento_tempo', 'commento_segnalate']) {
    const frasi = String(o[campo] ?? '').split(/(?<=[.!?;])\s+/);
    for (const frase of frasi) {
      const f = frase.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const radiciFrase = new Set(parole(frase).map(radice));
      const nominati = aspetti.filter((a) => a.chiavi.length && a.chiavi.some((k) => radiciFrase.has(k))).map((a) => a.nome);
      // «divisivo» si controlla da solo; le affermazioni sul tempo (critiche in aumento, apprezzamento in calo)
      // spesso stanno nella stessa frase e si riferiscono ad aspetti diversi: basta che l'aspetto ne rispetti una
      const [divisivo, ...tempo] = regole;
      if (divisivo.dice(f)) {
        const sbagliati = nominati.filter((n) => !divisivo.vale(n));
        if (sbagliati.length) problemi.push(`nel campo ${campo} la frase «${frase.trim().slice(0, 140)}» dice che ${sbagliati.join(', ')} ${divisivo.cosa}, ma nei fatti non e' cosi': togli quell'aspetto dalla frase o riformula senza quell'affermazione`);
      }
      const dette = tempo.filter((r) => r.dice(f));
      if (dette.length) {
        const sbagliati = nominati.filter((n) => !dette.some((r) => r.vale(n)));
        if (sbagliati.length) problemi.push(`nel campo ${campo} la frase «${frase.trim().slice(0, 140)}» dice che ${sbagliati.join(', ')} ${dette.map((r) => r.cosa).join(' o ')}, ma nei fatti non e' cosi': togli quell'aspetto dalla frase o riformula senza quell'affermazione`);
      }
    }
  }
  return problemi;
}
// <<< CONTROLLO AFFERMAZIONI (fine)

const aggregazioneFatti = $('Aggregazione').first().json.aggregazione;

function controlla(o) {
  if (!o) return ['la risposta non e\' un JSON valido'];
  // una citazione troppo lunga si ACCORCIA da sola alle prime 30 parole con «...» (resta copiata parola per parola):
  // il 17/11 il modello ha scelto tre volte la stessa citazione lunga e tutto il commento e' stato scartato
  for (const c of Array.isArray(o.citazioni) ? o.citazioni : []) {
    const parole = String(c.testo ?? '').trim().split(/\s+/);
    if (parole.length > 30) c.testo = parole.slice(0, 30).join(' ').replace(/[,;:]$/, '') + '...';
  }
  const problemi = [];
  for (const k of COMMENTI) {
    const t = String(o[k] ?? '').trim();
    if (!t) problemi.push(`il campo ${k} e' vuoto`);
    const cifre = t.match(/\d+/g);
    if (cifre) problemi.push(`il campo ${k} contiene cifre (${cifre.slice(0, 5).join(', ')}): descrivi a parole, senza numeri ne' anni`);
    if (/[«»]/.test(t)) problemi.push(`il campo ${k} contiene virgolette « »: le citazioni vanno solo nel campo "citazioni"`);
  }
  const cit = Array.isArray(o.citazioni) ? o.citazioni : [];
  for (const s of SEZIONI) if (!cit.some((c) => c.sezione === s)) problemi.push(`manca una citazione per la sezione "${s}"`);
  for (const c of cit) {
    const testo = testi.get(c.review_id);
    if (!testo) {
      problemi.push(`la citazione per "${c.sezione}" indica un identificativo inesistente (${c.review_id})`);
      continue;
    }
    const pezzi = norm(c.testo).split(/\.{3,}/).map((p) => p.trim().replace(/^["'.,;:\s]+|["',;:\s]+$/g, '')).filter((p) => p.length > 2);
    if (!pezzi.length || !pezzi.every((p) => norm(testo).includes(p))) {
      problemi.push(`la citazione «${String(c.testo).slice(0, 60)}...» non e' copiata parola per parola dalla recensione ${c.review_id}: copia frasi consecutive senza cambiare parole, oppure segna con "..." le parti saltate`);
    }
    if (String(c.testo).split(/\s+/).length > 40) problemi.push(`la citazione della recensione ${c.review_id} supera 30 parole`);
    // un frammento troppo corto non dice niente a chi legge
    // ...ma se la recensione intera e' corta, la citazione puo' essere tutta la recensione
    const paroleCit = String(c.testo).replace(/\.{3,}/g, ' ').trim().split(/\s+/).length;
    const paroleRec = String(testo).trim().split(/\s+/).length;
    if (paroleCit < 6 && paroleRec > paroleCit + 2) problemi.push(`la citazione della recensione ${c.review_id} e' troppo corta: scegli una frase di almeno 8 parole che si capisca da sola`);
    const numeriCitazione = new Set(String(c.testo).match(/\d+/g) ?? []);
    for (const n of String(c.traduzione ?? '').match(/\d+/g) ?? []) {
      if (!numeriCitazione.has(n)) problemi.push(`la traduzione della citazione ${c.review_id} contiene il numero ${n}, che non e' nella citazione`);
    }
  }
  problemi.push(...controllaAffermazioni(o, aggregazioneFatti));
  // niente frasi sulle lingue se non c'e' stato un confronto tra lingue (recensioni quasi tutte in una lingua)
  if (!fatti.lingue_confrontate) {
    for (const k of COMMENTI) if (/lingu/i.test(String(o[k] ?? ''))) problemi.push(`il campo ${k} parla di lingue, ma le recensioni sono quasi tutte in una sola lingua e non c'e' stato nessun confronto: togli la frase sulle lingue`);
  }
  return problemi;
}

// --- citazioni per la versione di riserva: una frase della recensione che contiene una parola dell'aspetto
function fraseSullAspetto(testo, paroleChiave) {
  // frasi di almeno 8 parole: un frammento corto non si capisce da solo (17/11)
  const frasi = testo.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 8);
  const scelta = frasi.find((s) => paroleChiave.some((k) => s.toLowerCase().includes(k))) ?? frasi[0] ?? testo;
  const parole = scelta.split(/\s+/);
  return parole.length > 30 ? parole.slice(0, 30).join(' ').replace(/[,;:]$/, '') + '...' : scelta;
}
function citazioniDiRiserva(sezione) {
  const giaCitate = new Set();
  return fatti.citazioni_disponibili
    .filter((c) => c.per.startsWith(sezione === 'apprezzati' ? 'apprezzato' : 'criticato'))
    .slice(0, 2)
    .map((c) => {
      const r = c.recensioni.find((x) => !giaCitate.has(x.review_id));
      if (!r) return null;
      giaCitate.add(r.review_id);
      return { sezione, review_id: r.review_id, testo: fraseSullAspetto(r.testo, c.parole_chiave ?? []), traduzione: '' };
    })
    .filter(Boolean);
}

// accenti veri al posto dell'apostrofo («e'» -> «è», «perche'» -> «perché»), solo FUORI dalle citazioni «...»,
// che restano copiate parola per parola (17/11: nello stesso testo c'erano «e'» del codice e «è» del modello)
const ACUTE = new Set(['perche', 'poiche', 'affinche', 'benche', 'finche', 'giacche', 'nonche', 'sicche', 'ne']);
const GRAVE = { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' };
const accentaPezzo = (s) => s.replace(/(^|[^A-Za-zÀ-ÿ'])([A-Za-zÀ-ÿ]*?)([aeiouAEIOU])'(?=[\s.,;:!?)\]]|$)/g, (m, prima, radice, v) => {
  const parola = (radice + v).toLowerCase();
  if (parola === 'po') return m;
  return prima + radice + (ACUTE.has(parola) && v.toLowerCase() === 'e' ? (v === 'E' ? 'É' : 'é') : GRAVE[v]);
});
const conAccenti = (testo) => String(testo).split(/(«[^»]*»)/).map((p) => (p.startsWith('«') ? p : accentaPezzo(p))).join('');

// --- composizione del digest
function componi(o) {
  const f = fatti;
  const r = [];
  const citazioni = (sezione) => {
    const lista = o ? (o.citazioni ?? []).filter((c) => c.sezione === sezione) : sezione === 'segnalate' ? [] : citazioniDiRiserva(sezione);
    return lista.flatMap((c) => [`> «${c.testo}» (${c.review_id})${c.traduzione ? ` [${c.traduzione}]` : ''}`, '']);
  };
  r.push('# Digest delle recensioni', '');

  r.push('## In sintesi', '', f.frase_sintesi, '');
  if ((f.frasi_piattaforme ?? []).length) { r.push('Per piattaforma (iOS e Android non si confrontano tra loro):', ''); for (const x of f.frasi_piattaforme) r.push(`- ${x}.`); r.push(''); }
  // lingue: una frase sola (17/11: prima una riga per lingua, ripetitive, e anche la lingua «und»)
  if (f.frase_lingue) r.push(f.frase_lingue, '');
  if (o) r.push(o.sintesi.trim(), '');

  r.push("## Cosa apprezzano di piu'", '');
  for (const x of f.aspetti_piu_apprezzati) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
  r.push('');
  if (o) r.push(o.commento_apprezzati.trim(), '');
  r.push(...citazioni('apprezzati'));

  r.push("## Cosa criticano di piu'", '');
  for (const x of f.aspetti_piu_criticati) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
  r.push('');
  if (f.aspetti_piu_divisivi.length) {
    r.push("Gli aspetti piu' divisivi, cioe' con pareri spaccati tra chi ne parla (tra il 30% e il 70% di giudizi negativi):", '');
    for (const x of f.aspetti_piu_divisivi) r.push(`- **${x.aspetto}**: ${x.frase_numeri}.`);
    r.push('');
  }
  if (o) r.push(o.commento_criticati.trim(), '');
  r.push(...citazioni('criticati'));

  r.push('## Come cambiano le cose nel tempo', '');
  r.push(`Le recensioni sono raggruppate in periodi con abbastanza recensioni per un confronto. Italiano e inglese sono confrontati separatamente, perche' la quota di recensioni in inglese cambia nel tempo. Sono stati fatti ${f.confronti_nel_tempo_eseguiti} confronti tra l'ultimo periodo e i precedenti: ${f.confronti_nel_tempo_significativi} risultano significativi dopo la correzione per confronti multipli.`, '');
  for (const x of f.cambiamenti_significativi) r.push(`- ${x.frase_numeri}.`);
  if (f.cambiamenti_significativi.length) r.push('');
  // versioni: solo le ultime con abbastanza recensioni (prima erano decine di righe); tutte nel foglio Versioni
  const NOME_PF = { ios: 'iOS', android: 'Android' };
  for (const p of f.per_piattaforma ?? []) {
    r.push(`Versioni dell'app su ${NOME_PF[p.piattaforma] ?? p.piattaforma} (le ultime con abbastanza recensioni per le statistiche):`, '');
    for (const v of p.versioni) {
      r.push(v.nota ? `- versione ${v.versione}: ${v.recensioni} recensioni, ${v.nota}.` : `- versione ${v.versione}: ${v.recensioni} recensioni, voto medio ${v.voto_medio}, positive ${v.positive}, negative ${v.negative}.`);
    }
    if (p.versioni_non_mostrate && p.versioni_non_mostrate !== '0') r.push(`- altre ${p.versioni_non_mostrate} versioni (piu' vecchie o con poche recensioni): nel foglio Versioni dell'Excel.`);
    for (const x of p.cambiamenti_ultima_versione) r.push(`- ${x.aspetto}${x.lingua ? ` (recensioni in ${x.lingua})` : ''}: ${x.misura} in ${x.direzione}, ${x.valore_ultima_versione} nella versione ${x.ultima_versione} contro ${x.valore_di_confronto} nella ${String(x.confrontata_con).replace(/^la /, '')}.`);
    r.push('');
  }
  if (o) r.push(o.commento_tempo.trim(), '');
  // periodi: gli ultimi 12 (prima erano decine di righe); tutti nei fogli Mesi e Due settimane dell'Excel
  const ULTIMI_PERIODI = 12;
  r.push(f.periodi.length > ULTIMI_PERIODI ? `Andamento per periodo (gli ultimi ${ULTIMI_PERIODI}; quelli prima sono nell'Excel, fogli Mesi e Due settimane):` : 'Andamento per periodo:', '');
  for (const p of f.periodi.slice(-ULTIMI_PERIODI)) r.push(`- ${maiusc(p.frase_numeri)}.`);
  r.push('');

  r.push('## Recensioni da guardare', '');
  if (f.frase_segnalate_recenti) r.push(f.frase_segnalate_recenti, '');
  r.push(f.frase_segnalate, '');
  if (f.frase_campagne) r.push(f.frase_campagne, '');
  for (const s of f.segnalate_da_mostrare) r.push(`- ${s.review_id} (${s.data}${s.voto ? `, voto ${s.voto}` : ''}, priorita' ${s.priorita}): ${String(s.motivo ?? '').replace(/\.\s*;/g, ';')}`);
  r.push('');
  if (o) r.push(o.commento_segnalate.trim(), '');
  r.push(...citazioni('segnalate'));

  r.push('## Come sono stati ottenuti questi numeri', '');
  r.push("Ogni recensione e' stata letta da un modello linguistico, nella sua lingua, che ne ha indicato il giudizio complessivo e il giudizio sugli aspetti di un elenco fisso. Tutti i numeri di questo testo sono conteggi calcolati dal sistema su quelle analisi; i cambiamenti nel tempo sono indicati solo quando superano la soglia statistica dopo la correzione per confronti multipli. Le segnalazioni seguono criteri fissati in anticipo e ognuna ha una frase di prova presa dalla recensione.");
  r.push('');
  r.push(o
    ? "I commenti a parole e la scelta delle citazioni sono del modello; ogni citazione e' stata controllata parola per parola sulla recensione originale."
    : "Questa versione non contiene i commenti del modello, perche' non hanno superato i controlli automatici; le citazioni sono scelte dal sistema.");
  // le righe delle citazioni («> ...») restano come sono; nelle altre accenti veri (fuori dalle «»)
  return r.map((riga) => (riga.startsWith('>') ? riga : conAccenti(riga))).join('\n');
}

// --- chiamata al modello con le correzioni
async function chiedi(messaggi) {
  const res = await helpers.httpRequest({
    method: 'POST',
    url: cfg.base_url + '/chat/completions',
    headers: { Authorization: 'Bearer ' + $env.OPENAI_API_KEY },
    body: { ...body, messages: messaggi },
    json: true,
    timeout: 180000,
  });
  if (res.usage) usoToken.push(res.usage);
  return String(res.choices?.[0]?.message?.content ?? '');
}

let risposta = String($input.first().json?.choices?.[0]?.message?.content ?? '');
let o = leggi(risposta);
let problemi = controlla(o);
const tentativi = [{ tentativo: 1, ok: problemi.length === 0, problemi }];
let messaggi = [...body.messages];
for (let t = 2; t <= 3 && problemi.length; t++) {
  messaggi = [
    ...messaggi,
    { role: 'assistant', content: risposta || '(vuoto)' },
    { role: 'user', content: 'La risposta non supera i controlli automatici. Correggi questi problemi e restituisci di nuovo il JSON completo:\n- ' + problemi.join('\n- ') },
  ];
  try {
    risposta = await chiedi(messaggi);
    o = leggi(risposta);
    problemi = controlla(o);
  } catch (e) {
    problemi = ['errore di chiamata al modello: ' + e.message];
  }
  tentativi.push({ tentativo: t, ok: problemi.length === 0, problemi });
}

const usaModello = problemi.length === 0;
const riserva = componi(null);
return [{
  json: {
    digest: usaModello ? componi(o) : riserva,
    origine: usaModello ? 'modello' : 'riserva_controlli_non_superati',
    verifica: { tentativi, esito_finale: { ok: usaModello, problemi } },
    uso_token: usoToken,
    digest_riserva: riserva,
    esito_riserva: { ok: true, nota: 'composto dal codice: numeri dalle frasi dei fatti, citazioni scelte dal sistema' },
    // risposta del modello scartata, conservata per capire perche'
    ultimo_testo_modello: usaModello ? null : risposta,
  },
}];
