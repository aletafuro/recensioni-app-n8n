// TELEGRAM: RIASSUNTO, DIGEST E AVVISI
// Alla fine di ogni giro, se TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID sono impostati:
// 1. un messaggio breve con i punti principali (numeri presi dall'aggregazione, scritti dal codice);
// 2. il digest completo come file digest.md (lo manda il nodo Telegram nativo che segue);
// 3. un avviso per ogni recensione NUOVA di questo giro con una segnalazione ad alta priorita'
//    (nuova = id dello store mai visto prima: si sa solo quando il giro scarica dallo store);
// 4. un avviso a grappolo quando almeno GRAPPOLO_MINIMO recensioni recenti riportano lo stesso problema sulla
//    stessa piattaforma e versione (calcolato nell'Aggregazione), se almeno una e' nuova di questo giro.
// I testi sono quelli gia' controllati dal workflow: le prove delle segnalazioni sono frasi
// esatte delle recensioni, con i dati personali gia' oscurati dal guardrail di ingresso.
// Se Telegram non risponde, il giro NON fallisce: l'errore resta scritto nel risultato.
const helpers = this.helpers;
const cfg = $('Configurazione').first().json;
const token = $env.TELEGRAM_BOT_TOKEN, chat = $env.TELEGRAM_CHAT_ID;
if (!token || !chat) return [{ json: { telegram: 'non configurato: mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID' } }];
// i giri di prova (cartella di uscita diversa da quella ufficiale) non mandano niente, salvo TELEGRAM_ANCHE_PROVE=true
if (cfg.output_dir !== '/files/output' && String($env.TELEGRAM_ANCHE_PROVE || '').toLowerCase() !== 'true') return [{ json: { telegram: 'non inviato: giro di prova in ' + cfg.output_dir } }];

const A = $('Aggregazione').first().json.aggregazione;
const fatti = $('Fatti per il digest').first().json.fatti;
let digest = '';
try { digest = $('Usa digest di riserva').first().json.digest; } catch (e) { digest = $('Verifica digest').first().json.digest; }
let unione = null;
try { unione = $('Unisci con l\'archivio').first().json; } catch (e) { unione = null; }
const nuove = new Set(unione?.nuove_id_store ?? []);

const api = (metodo) => `https://api.telegram.org/bot${token}/${metodo}`;
const esiti = [];
async function invia(testo) {
  try {
    const r = await helpers.httpRequest({ method: 'POST', url: api('sendMessage'), body: { chat_id: chat, text: conAccenti(testo).slice(0, 4000), disable_web_page_preview: true }, json: true, timeout: 30000 });
    esiti.push({ tipo: 'messaggio', ok: !!r.ok, testo: conAccenti(testo).slice(0, 4000) });  // il testo serve alla copia dei report
  } catch (e) {
    esiti.push({ tipo: 'messaggio', ok: false, errore: e.message, testo: conAccenti(testo).slice(0, 4000) });
  }
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

// --- 1. riassunto breve
const pct = (x) => `${String(x).replace('.', ',')}%`;
// numeri interi con il punto delle migliaia, uguali in tutto il messaggio (1.234, 12.345)
const mig = (x) => String(Math.round(Number(x))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const S = A.sentiment_complessivo;
// lingue delle recensioni (17/11: entrano anche le recensioni in inglese di Regno Unito e Stati Uniti)
const NOME_LINGUA = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese', ro: 'rumeno' };
const lingueOrd = Object.entries(A.lingue ?? {}).filter(([l]) => l !== 'und').sort((a, b) => b[1] - a[1]);
const totLingue = Object.values(A.lingue ?? {}).reduce((s, x) => s + x, 0);
const lingueGrandi = lingueOrd.filter(([, n]) => n >= 0.02 * totLingue);
const altreLingue = totLingue - lingueGrandi.reduce((s, [, n]) => s + n, 0);
const fraseLingue = lingueGrandi.length <= 1
  ? `in ${NOME_LINGUA[lingueGrandi[0]?.[0]] ?? lingueGrandi[0]?.[0] ?? 'italiano'}`
  : lingueGrandi.map(([l, n]) => `${mig(n)} in ${NOME_LINGUA[l] ?? l}`).join(', ') + (altreLingue > 0 ? `, ${mig(altreLingue)} in altre lingue o non riconosciute` : '');
const righe = [
  `Recensioni dell'app: giro del ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
  '',
  // date in formato gg/mm/aaaa come nel resto del messaggio (verifica alla cieca del 17/11)
  `${mig(A.meta.recensioni_aggregate)} recensioni scritte analizzate, ${fraseLingue} (dal ${String(A.meta.prima_data).split('-').reverse().join('/')} al ${String(A.meta.ultima_data).split('-').reverse().join('/')}), voto medio delle recensioni scritte ${String(A.voto_medio).replace('.', ',')} (non e' il voto dello store, che conta anche chi da' solo le stelle). Positive ${pct(S.positive.pct)}, negative ${pct(S.negative.pct)}.`,
];
if (unione) righe.push(`Nuove recensioni scaricate in questo giro: ${unione.nuove} (iOS ${unione.nuove_ios ?? '-'}, Android ${unione.nuove_android ?? '-'}).`);
righe.push('');
for (const x of fatti.frasi_piattaforme ?? []) righe.push(`- ${x}.`);
if (unione && unione.android && unione.android !== 'ok') righe.push(`(Android: ${unione.android})`);
if (unione && unione.ios && unione.ios !== 'ok') righe.push(`(iOS: ${unione.ios})`);
if (unione && unione.android_storico && !String(unione.android_storico).startsWith('ok')) righe.push(`(Storico Android: ${unione.android_storico})`);
// --- voto negli store per mercato (nodo «Voto negli store»): il voto che si vede negli store, con tutte le
//     valutazioni (anche quelle senza testo), confrontato con una settimana prima
let VS = null;
try { VS = $('Voto negli store').first().json.voto_store ?? null; } catch (e) { VS = null; }
if (VS) {
  const v2 = (x) => Number(x).toFixed(2).replace('.', ',');
  // punto delle migliaia sempre (toLocaleString in italiano non lo mette sui numeri di 4 cifre: «1234» accanto a «12.345»)
  const intero = (x) => String(Math.round(Number(x))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const gm2 = (d) => `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}`;
  righe.push('', 'Voto negli store per mercato (tutte le valutazioni, anche quelle senza testo, di ogni lingua):');
  if (VS.ios.stato !== 'ok') righe.push(`- iOS: ${VS.ios.stato}`);
  for (const p of VS.ios.paesi) {
    if (p.stato !== 'ok') { righe.push(`- iOS ${p.nome}: ${p.stato}`); continue; }
    let t = `- iOS ${p.nome}: ${v2(p.voto)} su ${intero(p.valutazioni)} valutazioni`;
    if (p.data_prima) {
      t += ` (il ${gm2(p.data_prima)}: ${v2(p.voto_prima)}`;
      if (p.media_voti_nuovi !== undefined && p.media_voti_nuovi !== null) t += `; da allora ${intero(p.voti_nuovi)} voti nuovi, media ${v2(p.media_voti_nuovi)}`;
      else if (p.media_voti_nuovi_nota) t += `; voti nuovi: ${p.media_voti_nuovi_nota}`;
      t += ')';
    } else t += ' (primo rilevamento: il confronto dalla prossima settimana)';
    righe.push(t);
  }
  if (VS.android.stato !== 'ok') righe.push(`- Android: ${VS.android.stato}`);
  for (const p of VS.android.paesi) {
    if (p.stato !== 'ok') { righe.push(`- Android ${p.nome}: ${p.stato}`); continue; }
    righe.push(`- Android ${p.nome}: ${v2(p.voto)} (dati di Google fino al ${gm2(p.dati_fino_al)}${p.data_prima ? `; il ${gm2(p.data_prima)}: ${v2(p.voto_prima)}` : ''})`);
  }
}
// --- ultima versione dell'app per piattaforma: contro la versione prima, e quale versione c'e' ora nello store
//     (richiesta del 17/11: il peggioramento di una versione deve essere scritto in chiaro nel messaggio)
{
  const NOMI_PF = { ios: 'iOS', android: 'Android' };
  const VP = VS?.versione_pubblicata ?? null;
  const righeV = [];
  for (const p of A.per_piattaforma ?? []) {
    const nv = p.negative_ultima_versione;
    if (!nv) continue;
    const inStore = VP?.[p.piattaforma] ?? null;
    const store = inStore ? (inStore === nv.ultima_versione ? ' (è quella pubblicata ora nello store)' : `; nello store ora c'è la ${inStore}`) : '';
    // una riga per lingua: italiano e inglese separati (la quota di inglese puo' cambiare da una versione all'altra)
    let t = `- ${NOMI_PF[p.piattaforma] ?? p.piattaforma} ${nv.ultima_versione}${store}, contro la ${nv.versione_prima}:`;
    for (const x of nv.per_lingua ?? []) {
      if (!x.recensioni_ultima) continue;
      t += `\n  in ${NOME_LINGUA[x.lingua] ?? x.lingua}: ${pct(x.pct_negative_ultima)} negative o miste su ${mig(x.recensioni_ultima)} recensioni, contro ${x.recensioni_prima ? pct(x.pct_negative_prima) + ' su ' + mig(x.recensioni_prima) : 'nessuna recensione'}: `;
      t += x.esito === 'pochi dati' ? 'pochi dati per un verdetto.' : x.esito === 'oltre il rumore' ? (x.differenza_punti > 0 ? 'PEGGIORATA, oltre il rumore statistico.' : 'migliorata, oltre il rumore statistico.') : 'differenza entro il rumore statistico.';
    }
    const peggio = (p.andamento_ultima_versione ?? []).filter((x) => x.significativo && ((x.misura === 'pct_recensioni_che_lo_criticano' && x.differenza_punti > 0) || (x.misura === 'pct_recensioni_che_lo_apprezzano' && x.differenza_punti < 0)));
    for (const x of peggio) t += `\n  ${x.nome} (in ${NOME_LINGUA[x.lingua] ?? x.lingua}): ${x.misura === 'pct_recensioni_che_lo_criticano' ? 'criticato' : 'apprezzato'} nel ${pct(x.valore_nuovo)} delle recensioni contro il ${pct(x.valore_confronto)} della ${nv.versione_prima} (oltre il rumore).`;
    righeV.push(t);
  }
  if (VP && /^in rilascio/.test(VP.android_stato ?? '')) righeV.push(`(Android ${VP.android}: ${VP.android_stato})`);
  else if (VP && VP.android_stato && VP.android_stato !== 'ok') righeV.push(`(Versione Android nello store: ${VP.android_stato})`);
  if (righeV.length) righe.push('', "Ultima versione dell'app con abbastanza recensioni, contro la versione prima:", ...righeV);
}
righe.push('', 'Piu\' criticati:');
for (const x of A.classifiche.piu_criticati.slice(0, 3)) righe.push(`- ${x.nome}: ${mig(x.recensioni_negative)} recensioni (${pct(x.pct_recensioni_che_lo_criticano)} del totale)`);
// andamento per piattaforma: ultime due settimane complete e ultimo mese completo, contro il periodo prima
// (numeri e verdetti dall'Aggregazione: «oltre il rumore», «entro il rumore» o «pochi dati»)
const PC = A.periodi_di_calendario;
if (PC) {
  const NOMI = { ios: 'iOS', android: 'Android' };
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const gm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const nomePeriodo = (p, tipo) => (tipo === 'mesi' ? `${MESI[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : `dal ${gm(p.slice(0, 10))} al ${gm(p.slice(-10))}`);
  // il periodo e' scritto su ogni riga: iOS e Android possono avere ultimi periodi completi diversi
  // (correzione dopo la verifica alla cieca del 16/11: «pochi dati» anche quando manca il periodo prima,
  // e «dati solo dal» quando il periodo e' il primo dell'archivio e parte a meta')
  for (const [tipo, titolo] of [['due_settimane', 'Ultime due settimane complete'], ['mesi', 'Ultimo mese completo']]) {
    const righeP = [];
    for (const s of PC[tipo].filter((x) => x.piattaforma !== 'tutte')) {
      const p = [...s.periodi].reverse().find((x) => !x.in_corso);
      if (!p) continue;
      const testa = `- ${NOMI[s.piattaforma] ?? s.piattaforma}${s.lingua ? ' in ' + (NOME_LINGUA[s.lingua] ?? s.lingua) : ''}, ${nomePeriodo(p.periodo, tipo)}${p.dati_solo_dal ? ` (dati solo dal ${gm(p.dati_solo_dal)})` : ''}`;
      if (!p.recensioni) { righeP.push(`${testa}: nessuna recensione`); continue; }
      const c = p.confronto;
      let t = `${testa}: ${p.recensioni} recensioni, ${pct(p.pct_negative)} negative`;
      if (c && c.pct_negative_prima !== null) t += ` (prima ${pct(c.pct_negative_prima)}): ${c.esito}`;
      else t += ` (nessun dato sul periodo prima${p.recensioni < 20 ? '; pochi dati' : ''})`;
      righeP.push(t);
    }
    if (righeP.length) righe.push('', `${titolo}:`, ...righeP);
  }
}
const sig = A.andamento.filter((x) => x.significativo);
righe.push('', sig.length ? `Temi: ${sig.length} cambiamenti oltre la soglia statistica tra l'ultimo periodo e i precedenti (dettagli nel digest).` : 'Temi: nessun cambiamento oltre la soglia statistica tra l\'ultimo periodo e i precedenti.');
// recensioni da guardare: prima quelle RECENTI (su cui si puo' fare qualcosa), poi il totale dell'archivio
// (il totale di anni di archivio e' troppo per chi legge ogni settimana)
const giornoN = (d) => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000);
const oggiN = giornoN(cfg.grappolo_oggi ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }));
const daGuardareRecenti = $('Valida e completa').all().map((i) => i.json)
  .filter((r) => r.needs_attention && r.stato !== 'duplicato' && r.published_date && oggiN - giornoN(r.published_date) < cfg.avvisi_giorni);
righe.push(`Da guardare negli ultimi ${cfg.avvisi_giorni} giorni: ${daGuardareRecenti.length} recensioni, ${daGuardareRecenti.filter((r) => (r.segnalazioni ?? []).length).length} con un problema preciso, di cui ${daGuardareRecenti.filter((r) => r.priorita === 'alta').length} con priorita' alta (foglio Segnalazioni dell'Excel).`);
const S2 = A.segnalazioni;
const precise = S2.con_un_problema_preciso ?? null;
righe.push(precise === null
  ? `In tutto l'archivio: ${S2.totale} segnalate, di cui ${S2.per_priorita.alta} con priorita' alta.`
  : `In tutto l'archivio (dal ${String(A.meta.prima_data).slice(0, 4)}): ${mig(S2.totale)} da guardare, ${mig(precise)} con un problema preciso, di cui ${mig(S2.per_priorita.alta)} con priorita' alta; le altre ${mig(S2.totale - precise)} solo per voto basso o per voto e testo in contrasto.`);
if (fatti.frase_campagne) righe.push('', fatti.frase_campagne);
// avvisi a grappolo (vedi Aggregazione): solo quelli con almeno una recensione nuova di questo giro,
// cosi' lo stesso grappolo non viene ripetuto a ogni giro se non arriva niente di nuovo
const G = A.avviso_a_grappolo ?? { grappoli: [] };
const grappoliDaAvvisare = G.grappoli.filter((g) => g.recensioni.some((x) => nuove.has(x.chiave_store)));
if (grappoliDaAvvisare.length) righe.push('', `Avvisi a grappolo: ${grappoliDaAvvisare.length} (stesso problema sulla stessa versione, in ${cfg.grappolo_giorni} giorni). Li trovi qui sotto.`);
// grappoli ancora aperti ma senza recensioni nuove: una riga sola, senza ripetere l'avviso (verifica alla cieca 17/11:
// il messaggio taceva un grappolo vero solo perche' le sue recensioni erano gia' state viste)
const grappoliAperti = G.grappoli.filter((g) => !grappoliDaAvvisare.includes(g));
if (grappoliAperti.length) {
  const NPF = { ios: 'iOS', android: 'Android' };
  righe.push('', `Grappoli ancora aperti negli ultimi ${cfg.grappolo_giorni} giorni, senza recensioni nuove: ${grappoliAperti.map((g) => `${NPF[g.piattaforma] ?? g.piattaforma}${g.versione ? ' ' + g.versione : ''}, ${g.nome_categoria} (${g.quante})`).join('; ')}. Dettagli nel foglio Grappoli dell'Excel.`);
}
righe.push('', 'Il digest completo e\' nel file qui sotto.');
await invia(righe.join('\n'));

// --- 2. il digest completo lo manda come file il nodo Telegram nativo (qui sotto): dal nodo Code i file
//        arrivano rovinati (prova del 14/11: "there is no document in the request")

// --- 3. avvisi per le recensioni nuove con priorita' alta
const recensioni = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));
const analisi = $('Valida e completa').all().map((i) => i.json);
// solo recensioni RECENTI (pubblicate negli ultimi AVVISI_GIORNI giorni): quando entra uno storico (per esempio
// i report Android di anni) migliaia di recensioni sono «nuove» per l'archivio ma vecchie per chi legge,
// e non devono diventare avvisi urgenti. Restano nell'archivio, nelle analisi, nel digest e nell'Excel.
const giornoDi = (d) => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000);
const oggiAvvisi = giornoDi(cfg.grappolo_oggi ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }));
const recente = (x) => x.published_date && oggiAvvisi - giornoDi(x.published_date) < cfg.avvisi_giorni;
const nuoveAlta = analisi.filter((r) => {
  const x = recensioni.get(r.review_id);
  return x && nuove.has(`${x.piattaforma}|${x.id_store}`) && (r.segnalazioni ?? []).some((s) => s.priorita === 'alta');
});
const urgenti = nuoveAlta.filter((r) => recente(recensioni.get(r.review_id)));
const MAX_AVVISI = 15;
for (const r of urgenti.slice(0, MAX_AVVISI)) {
  const x = recensioni.get(r.review_id);
  const s = r.segnalazioni.find((y) => y.priorita === 'alta');
  await invia([
    `Avviso: ${s.nome_categoria} (priorita' alta)`,
    `Recensione ${r.review_id}, ${x.published_date ?? ''}, voto ${x.rating ?? '-'}, ${x.piattaforma}${x.versione ? ' ' + x.versione : ''}`,
    // le recensioni sono affermazioni dell'utente, non fatti accertati: si dice sempre chi lo afferma
    /^(l'utente|secondo l'utente)/i.test(s.sintesi) ? s.sintesi : `Secondo l'utente: ${s.sintesi}`,
    `Dalla recensione: «${s.evidenza}»`,
  ].join('\n'));
}
if (urgenti.length > MAX_AVVISI) await invia(`Altre ${urgenti.length - MAX_AVVISI} recensioni nuove con priorita' alta: sono nel digest e in recensioni_diagnostica.jsonl.`);
if (nuoveAlta.length > urgenti.length) await invia(`Nell'archivio sono entrate anche ${nuoveAlta.length - urgenti.length} recensioni con priorita' alta piu' vecchie di ${cfg.avvisi_giorni} giorni (storico): niente avvisi singoli, sono nel digest e nel foglio Segnalazioni dell'Excel.`);

// --- 4. avvisi a grappolo: stesso problema, stessa piattaforma e stessa versione, in pochi giorni
//        (per esempio tre persone che sulla stessa versione scrivono «ho pagato ma non ho ricevuto l'acquisto»)
const NOME_PF = { ios: 'iOS', android: 'Android' };
const dataIt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const MAX_GRAPPOLI = 10, MAX_FRASI = 5;
for (const g of grappoliDaAvvisare.slice(0, MAX_GRAPPOLI)) {
  const pf = NOME_PF[g.piattaforma] ?? g.piattaforma;
  const nuoveQui = g.recensioni.filter((x) => nuove.has(x.chiave_store)).length;
  const inStore = VS?.versione_pubblicata?.[g.piattaforma] ?? null;
  const frase = !g.versione
    ? 'Lo store non indica la versione.'
    : inStore
      ? (inStore === g.versione ? `È la versione pubblicata ora nello store ${pf}: la scaricano i nuovi utenti.` : `Nello store ${pf} ora c'è la versione ${inStore}: chi ha questo problema ha una versione diversa.`)
      : (g.e_la_versione_piu_recente
        ? `È la versione più recente tra quelle viste nelle recensioni ${pf} (la versione dello store non è stata letta).`
        : `È una versione vecchia: la più recente vista nelle recensioni ${pf} è la ${g.versione_piu_recente_vista}.`);
  const testo = [
    `Avviso a grappolo: ${g.nome_categoria}`,
    `${g.quante} recensioni ${pf}${g.versione ? ' sulla versione ' + g.versione : ''} dal ${dataIt(g.dal)} al ${dataIt(g.al)}, ${nuoveQui} nuove in questo giro.`,
    frase,
    'Dalle recensioni (sono affermazioni degli utenti):',
    ...g.recensioni.slice(0, MAX_FRASI).map((x) => `- «${x.evidenza}» (voto ${x.voto ?? '-'}, ${dataIt(x.data)})`),
  ];
  if (g.quante > MAX_FRASI) testo.push(`... e altre ${g.quante - MAX_FRASI}: sono in aggregazione.json.`);
  testo.push('Da confrontare con i ticket del servizio clienti.');
  await invia(testo.join('\n'));
}
if (grappoliDaAvvisare.length > MAX_GRAPPOLI) await invia(`Altri ${grappoliDaAvvisare.length - MAX_GRAPPOLI} avvisi a grappolo: sono in aggregazione.json.`);

// esito scritto accanto agli altri risultati (telegram.json), per controllare che cosa e' partito
const esito = {
  inviato_il: new Date().toISOString(),
  avvisi_urgenti: urgenti.length,
  avvisi_a_grappolo: grappoliDaAvvisare.map((g) => ({ categoria: g.categoria, piattaforma: g.piattaforma, versione: g.versione, quante: g.quante })),
  nuove_recensioni: unione?.nuove ?? null,
  esiti,
};
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
return [{
  json: { telegram: 'testi inviati', path: `${cfg.output_dir}/telegram.json`, chat_id: String(chat), ...esito },
  binary: {
    data: { data: b64(digest), mimeType: 'text/markdown', fileName: 'digest.md' },
    esito: { data: b64(JSON.stringify(esito, null, 2)), mimeType: 'application/json', fileName: 'telegram.json' },
  },
}];
