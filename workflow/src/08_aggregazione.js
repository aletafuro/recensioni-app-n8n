// AGGREGAZIONE
// Dalle analisi delle singole recensioni calcola, per ogni aspetto, quanto e'
// apprezzato e quanto e' criticato, sull'intero archivio e nel tempo.
// Tutti i numeri del digest vengono da qui.
//
// Scelte:
// - Si contano le recensioni, non le frasi: un aspetto vale al massimo 1 per recensione.
// - Classifica principale per VOLUME: quante recensioni apprezzano/criticano
//   l'aspetto (cio' che tocca piu' ospiti). Classifica secondaria per TASSO:
//   tra le recensioni che ne parlano, quota di giudizi positivi/negativi,
//   solo per aspetti con almeno MIN_MENTIONS_RATE_RANKING menzioni.
// - Tempo: base annuale (data di pubblicazione, sempre presente). Gli anni con
//   poche recensioni vengono uniti ai successivi finche' il periodo ha almeno
//   MIN_REVIEWS_PER_PERIOD recensioni, perche' l'archivio non e' uniforme.
// - Andamento: l'ultimo periodo e' confrontato con tutti i precedenti e con il
//   periodo subito prima (test su due proporzioni). Un cambiamento e'
//   "significativo" solo se resta tale dopo la correzione per confronti
//   multipli (Benjamini-Hochberg, falsi positivi attesi al massimo 10%).
const cfg = $('Configurazione').first().json;
const ctx = $('Valida contesto').first().json;
const tax = $('Valida tassonomia').first().json;
const fileInfo = $('Recensioni pronte').first().json._file;
const tutte = $input.all().map((i) => i.json);
const infoAnalisi = tutte[0]._analisi;

// nei conteggi: solo recensioni analizzate, non duplicate e non sospette di manipolazione
const valide = tutte.filter((r) => (r.stato === 'ok' || r.stato === 'ritentata') && !r.sospetta);
const N = valide.length;
if (N === 0) throw new Error('Nessuna recensione analizzata correttamente: aggregazione impossibile');

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const media = (xs) => (xs.length ? Math.round((100 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 100 : null);

function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(1000 * Math.max(0, c - m)) / 10, Math.round(1000 * Math.min(1, c + m)) / 10];
}
// funzione di ripartizione normale (approssimazione di Abramowitz-Stegun)
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function dueProporzioni(k1, n1, k0, n0) {
  const p1 = k1 / n1, p0 = k0 / n0, p = (k1 + k0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  const z = se > 0 ? (p1 - p0) / se : 0;
  return { z: Math.round(100 * z) / 100, p_value: 2 * (1 - phi(Math.abs(z))) };
}

function contaSentiment(lista) {
  const c = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const r of lista) c[r.overall_sentiment]++;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { recensioni: v, pct: pct(v, lista.length) }]));
}

function statAspetti(lista) {
  const n = lista.length;
  const out = {};
  for (const a of tax.aspetti) {
    let pos = 0, neg = 0, neu = 0;
    for (const r of lista) {
      const x = r.aspects.find((y) => y.aspect === a.aspect);
      if (!x) continue;
      if (x.sentiment === 'positive') pos++;
      else if (x.sentiment === 'negative') neg++;
      else neu++;
    }
    const m = pos + neg + neu;
    out[a.aspect] = {
      aspect: a.aspect,
      nome: a.nome,
      menzioni: m,
      positive: pos,
      negative: neg,
      neutral: neu,
      pct_recensioni_che_ne_parlano: pct(m, n),
      pct_recensioni_che_lo_apprezzano: pct(pos, n),
      pct_recensioni_che_lo_criticano: pct(neg, n),
      pct_positive_su_menzioni: pct(pos, m),
      pct_negative_su_menzioni: pct(neg, m),
      ic95_pct_negative_su_menzioni: wilson(neg, m),
      saldo: m ? Math.round((100 * (pos - neg)) / m) / 100 : null,
    };
  }
  return out;
}

const classifica = (stat, campo, filtro = () => true) =>
  Object.values(stat)
    .filter((s) => s[campo] > 0 && filtro(s))
    .sort((a, b) => b[campo] - a[campo] || b.menzioni - a.menzioni || a.aspect.localeCompare(b.aspect));

// --- intero archivio
const statTotali = statAspetti(valide);
const conPos = (s) => ({ aspect: s.aspect, nome: s.nome, recensioni_positive: s.positive, pct_recensioni_che_lo_apprezzano: s.pct_recensioni_che_lo_apprezzano, pct_positive_su_menzioni: s.pct_positive_su_menzioni, menzioni: s.menzioni });
const conNeg = (s) => ({ aspect: s.aspect, nome: s.nome, recensioni_negative: s.negative, pct_recensioni_che_lo_criticano: s.pct_recensioni_che_lo_criticano, pct_negative_su_menzioni: s.pct_negative_su_menzioni, menzioni: s.menzioni });
const numera = (lista) => lista.map((x, i) => ({ posizione: i + 1, ...x }));
const minM = cfg.min_mentions_rate_ranking;

const classifiche = {
  piu_apprezzati: numera(classifica(statTotali, 'positive').map(conPos)),
  piu_criticati: numera(classifica(statTotali, 'negative').map(conNeg)),
  piu_apprezzati_per_tasso: numera(classifica(statTotali, 'pct_positive_su_menzioni', (s) => s.menzioni >= minM).map(conPos)),
  piu_criticati_per_tasso: numera(classifica(statTotali, 'pct_negative_su_menzioni', (s) => s.menzioni >= minM).map(conNeg)),
};

// --- lingue nei confronti nel tempo (17/11): l'italiano e l'inglese restano SEMPRE separati, come iOS e Android.
// Se la quota di recensioni in inglese cresce nel tempo e l'inglese e' meno negativo (come nei dati veri dell'autrice),
// un confronto con tutte le lingue insieme scambierebbe il cambio di composizione per un miglioramento.
// Le altre lingue sono poche: restano nei conteggi ma non nei confronti nel tempo.
const LINGUE_TEMPO = ['it', 'en'];
const inLingua = (lista, l) => lista.filter((r) => r.language === l);
const negOMisteN = (l) => l.filter((r) => r.overall_sentiment === 'negative' || r.overall_sentiment === 'mixed').length;

// --- periodi
// unita' di tempo scelta in configurazione (anno, trimestre o mese), dalla data
// di pubblicazione. Le unita' con poche recensioni si uniscono alle successive
// finche' il periodo ha almeno MIN_REVIEWS_PER_PERIOD recensioni.
const unita = (r) => {
  if (!r.published_date) return null;
  const a = r.published_date.slice(0, 4);
  const m = Number(r.published_date.slice(5, 7));
  if (cfg.granularita === 'mese') return `${a}-${String(m).padStart(2, '0')}`;
  if (cfg.granularita === 'trimestre') return `${a}-T${Math.ceil(m / 3)}`;
  return a;
};
const perUnita = new Map();
for (const r of valide) {
  const u = unita(r);
  if (u) perUnita.set(u, (perUnita.get(u) ?? 0) + 1);
}
const chiavi = [...perUnita.keys()].sort();
const posizione = new Map(chiavi.map((k, i) => [k, i]));
const idx = (r) => (unita(r) === null ? -1 : posizione.get(unita(r)));
const periodiGrezzi = [];
let corrente = null;
chiavi.forEach((k, i) => {
  corrente ??= { dal: k, al: k, i0: i, i1: i, n: 0 };
  corrente.al = k;
  corrente.i1 = i;
  corrente.n += perUnita.get(k);
  if (corrente.n >= cfg.min_reviews_per_period) {
    periodiGrezzi.push(corrente);
    corrente = null;
  }
});
if (corrente) {
  // le ultime unita' rimaste sotto la soglia si uniscono al periodo precedente
  if (periodiGrezzi.length) {
    const u = periodiGrezzi[periodiGrezzi.length - 1];
    u.al = corrente.al;
    u.i1 = corrente.i1;
    u.n += corrente.n;
  } else periodiGrezzi.push(corrente);
}
const nelPeriodo = (r, p) => {
  const i = idx(r);
  return i >= p.i0 && i <= p.i1;
};
const etichetta = (p) => (p.dal === p.al ? p.dal : `${p.dal} / ${p.al}`);

const periodi = periodiGrezzi.map((p) => {
  const lista = valide.filter((r) => nelPeriodo(r, p));
  const stat = statAspetti(lista);
  return {
    periodo: etichetta(p),
    dal: p.dal,
    al: p.al,
    i0: p.i0,
    i1: p.i1,
    recensioni: lista.length,
    voto_medio: media(lista.filter((r) => r.rating !== null).map((r) => r.rating)),
    sentiment_complessivo: contaSentiment(lista),
    piu_apprezzati: classifica(stat, 'positive').slice(0, 5).map((s) => s.aspect),
    piu_criticati: classifica(stat, 'negative').slice(0, 5).map((s) => s.aspect),
    aspetti: stat,
    per_lingua: LINGUE_TEMPO.map((l) => {
      const ll = inLingua(lista, l);
      return { lingua: l, recensioni: ll.length, pct_negative: pct(ll.filter((r) => r.overall_sentiment === 'negative').length, ll.length) };
    }),
  };
});

// --- confronti: test su due proporzioni per aspetto, poi Benjamini-Hochberg
const conta = (lista, aspect, sentiment) => lista.filter((r) => r.aspects.some((x) => x.aspect === aspect && x.sentiment === sentiment)).length;
function confronta(listaNuova, listaVecchia) {
  const out = [];
  if (listaNuova.length < 30 || listaVecchia.length < 30) return out;
  for (const a of tax.aspetti) {
    for (const [misura, sentiment] of [['pct_recensioni_che_lo_criticano', 'negative'], ['pct_recensioni_che_lo_apprezzano', 'positive']]) {
      const k1 = conta(listaNuova, a.aspect, sentiment);
      const k0 = conta(listaVecchia, a.aspect, sentiment);
      if (k1 + k0 < 10) continue; // troppo pochi casi per dire qualcosa
      const t = dueProporzioni(k1, listaNuova.length, k0, listaVecchia.length);
      out.push({
        aspect: a.aspect,
        nome: a.nome,
        misura,
        valore_nuovo: pct(k1, listaNuova.length),
        valore_confronto: pct(k0, listaVecchia.length),
        differenza_punti: Math.round(10 * (pct(k1, listaNuova.length) - pct(k0, listaVecchia.length))) / 10,
        z: t.z,
        p_value: Math.round(10000 * t.p_value) / 10000,
      });
    }
  }
  return out;
}
function benjaminiHochberg(lista) {
  const ordinati = [...lista].sort((a, b) => a.p_value - b.p_value);
  const m = ordinati.length;
  let soglia = -1;
  ordinati.forEach((x, i) => {
    if (x.p_value <= ((i + 1) / m) * 0.1) soglia = i;
  });
  ordinati.forEach((x, i) => {
    x.significativo = i <= soglia;
    x.direzione = x.differenza_punti > 0 ? 'aumento' : x.differenza_punti < 0 ? 'calo' : 'stabile';
  });
  return lista;
}

// --- andamento nel tempo: ultimo periodo contro i precedenti
const andamento = [];
if (periodi.length >= 2) {
  const ultimo = periodi[periodi.length - 1];
  const penultimo = periodi[periodi.length - 2];
  // un confronto per lingua (stessi periodi di calendario); confronta() salta le liste sotto 30 recensioni
  for (const lingua of LINGUE_TEMPO) {
  const listaUltimo = valide.filter((r) => r.language === lingua && nelPeriodo(r, ultimo));
  const listaPrima = valide.filter((r) => r.language === lingua && idx(r) >= 0 && idx(r) < ultimo.i0);
  const listaPenultimo = valide.filter((r) => r.language === lingua && nelPeriodo(r, penultimo));
  const confronti = [
    { contro: 'tutti_i_periodi_precedenti', etichetta: `${periodi[0].dal} / ${penultimo.al}`, lista: listaPrima },
    { contro: 'periodo_precedente', etichetta: penultimo.periodo, lista: listaPenultimo },
  ];
  for (const c of confronti) {
    for (const x of confronta(listaUltimo, c.lista)) {
      andamento.push({
        lingua,
        recensioni_ultimo_periodo: listaUltimo.length,
        recensioni_periodo_di_confronto: c.lista.length,
        aspect: x.aspect,
        nome: x.nome,
        misura: x.misura,
        ultimo_periodo: ultimo.periodo,
        confronto_con: c.contro,
        periodo_di_confronto: c.etichetta,
        valore_ultimo_periodo: x.valore_nuovo,
        valore_periodo_di_confronto: x.valore_confronto,
        differenza_punti: x.differenza_punti,
        z: x.z,
        p_value: x.p_value,
      });
    }
  }
  }
  benjaminiHochberg(andamento); // correzione su tutti i confronti insieme, delle due lingue
}

// --- per piattaforma e per versione dell'app
// iOS e Android restano sempre separati: le versioni sono numerate in modo
// indipendente sulle due piattaforme. Per ogni piattaforma si confronta l'ultima
// versione con abbastanza recensioni con la versione prima (anch'essa con abbastanza recensioni).
function ordineVersione(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10));
  const pb = String(b).split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return String(a).localeCompare(String(b));
    if (x !== y) return x - y;
  }
  return 0;
}
const perPiattaforma = [...new Set(valide.map((r) => r.piattaforma ?? 'non indicata'))].sort().map((pf) => {
  const lista = valide.filter((r) => (r.piattaforma ?? 'non indicata') === pf);
  const stat = statAspetti(lista);
  const versioni = [...new Set(lista.map((r) => r.versione).filter(Boolean))].sort(ordineVersione).map((v) => {
    const lv = lista.filter((r) => r.versione === v);
    if (lv.length < cfg.min_reviews_per_version) return { versione: v, recensioni: lv.length, sotto_il_minimo: true };
    const sv = statAspetti(lv);
    return {
      versione: v,
      recensioni: lv.length,
      voto_medio: media(lv.filter((r) => r.rating !== null).map((r) => r.rating)),
      sentiment_complessivo: contaSentiment(lv),
      piu_apprezzati: classifica(sv, 'positive').slice(0, 3).map((s) => s.aspect),
      piu_criticati: classifica(sv, 'negative').slice(0, 3).map((s) => s.aspect),
      aspetti: sv,
    };
  });
  const conDati = versioni.filter((v) => !v.sotto_il_minimo);
  // ultima versione con abbastanza recensioni contro la versione PRIMA (17/11: prima si confrontava con tutte le
  // versioni dal 2019, che non dice se l'ultima va peggio di quella che ha sostituito)
  let andamentoVersioni = [], negativeUltimaVersione = null;
  if (conDati.length >= 2) {
    const ultima = conDati[conDati.length - 1].versione, precedente = conDati[conDati.length - 2].versione;
    // per lingua (17/11): due versioni possono avere quote di inglese diverse
    const perL = LINGUE_TEMPO.map((lingua) => ({ lingua, lu: lista.filter((r) => r.versione === ultima && r.language === lingua), lp: lista.filter((r) => r.versione === precedente && r.language === lingua) }));
    andamentoVersioni = benjaminiHochberg(perL.flatMap(({ lingua, lu, lp }) => confronta(lu, lp).map((x) => ({ ...x, lingua, ultima_versione: ultima, confrontata_con: `la versione ${precedente}` }))));
    // quota di recensioni negative o miste: un test per lingua, solo con almeno 30 recensioni per versione;
    // correzione di Benjamini-Hochberg sui test delle due lingue
    const testNeg = perL.map(({ lingua, lu, lp }) => {
      const x = { lingua, recensioni_ultima: lu.length, recensioni_prima: lp.length, pct_negative_ultima: pct(negOMisteN(lu), lu.length), pct_negative_prima: pct(negOMisteN(lp), lp.length) };
      if (lu.length < 30 || lp.length < 30) return { ...x, esito: 'pochi dati' };
      const t = dueProporzioni(negOMisteN(lu), lu.length, negOMisteN(lp), lp.length);
      return { ...x, p_value: Math.round(10000 * t.p_value) / 10000, differenza_punti: Math.round(10 * (x.pct_negative_ultima - x.pct_negative_prima)) / 10 };
    });
    benjaminiHochberg(testNeg.filter((x) => x.p_value !== undefined));
    for (const x of testNeg) if (x.p_value !== undefined) x.esito = x.significativo ? 'oltre il rumore' : 'entro il rumore';
    negativeUltimaVersione = { ultima_versione: ultima, versione_prima: precedente, per_lingua: testNeg };
  }
  return {
    piattaforma: pf,
    recensioni: lista.length,
    voto_medio: media(lista.filter((r) => r.rating !== null).map((r) => r.rating)),
    sentiment_complessivo: contaSentiment(lista),
    piu_apprezzati: classifica(stat, 'positive').slice(0, 5).map((s) => s.aspect),
    piu_criticati: classifica(stat, 'negative').slice(0, 5).map((s) => s.aspect),
    aspetti: stat,
    versioni,
    andamento_ultima_versione: andamentoVersioni,
    negative_ultima_versione: negativeUltimaVersione,
  };
});

// --- per lingua
// La lingua e' un'informazione: se le recensioni negative venissero soprattutto da
// una lingua, sarebbe un segnale per la direzione. Ogni lingua con almeno
// MIN_LINGUA recensioni e' confrontata con tutte le altre insieme sulla quota di
// recensioni negative o miste (test su due proporzioni, correzione Benjamini-Hochberg).
const MIN_LINGUA = 15;
const negativeOMiste = (lista) => lista.filter((r) => r.overall_sentiment === 'negative' || r.overall_sentiment === 'mixed').length;
const conteggioLingue = new Map();
for (const r of valide) conteggioLingue.set(r.language, (conteggioLingue.get(r.language) ?? 0) + 1);
const perLingua = [...conteggioLingue].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([lingua, n]) => {
  const lista = valide.filter((r) => r.language === lingua);
  // «und» (lingua non riconosciuta: solo emoji, «Top»...) non e' una lingua: resta fuori dai confronti (17/11)
  const altre = valide.filter((r) => r.language !== lingua && r.language !== 'und');
  const base = {
    lingua,
    recensioni: n,
    voto_medio: media(lista.filter((r) => r.rating !== null).map((r) => r.rating)),
    sentiment_complessivo: contaSentiment(lista),
  };
  if (lingua === 'und' || n < MIN_LINGUA || altre.length < 30) return { ...base, confronto_con_le_altre_lingue: null };
  const k1 = negativeOMiste(lista);
  const k0 = negativeOMiste(altre);
  const t = dueProporzioni(k1, n, k0, altre.length);
  return {
    ...base,
    confronto_con_le_altre_lingue: {
      misura: 'pct_recensioni_negative_o_miste',
      valore_lingua: pct(k1, n),
      valore_altre_lingue: pct(k0, altre.length),
      differenza_punti: Math.round(10 * (pct(k1, n) - pct(k0, altre.length))) / 10,
      z: t.z,
      p_value: Math.round(10000 * t.p_value) / 10000,
    },
  };
});
{
  const confronti = perLingua.map((x) => x.confronto_con_le_altre_lingue).filter(Boolean).sort((a, b) => a.p_value - b.p_value);
  let soglia = -1;
  confronti.forEach((x, i) => {
    if (x.p_value <= ((i + 1) / confronti.length) * 0.1) soglia = i;
  });
  confronti.forEach((x, i) => {
    x.significativo = i <= soglia;
    x.direzione = x.differenza_punti > 0 ? 'piu_negative' : x.differenza_punti < 0 ? 'meno_negative' : 'uguale';
  });
}

// --- serie annuale grezza (conteggi), per chi vuole ricalcolare con altre granularita'
const anni = [...new Set(valide.filter((r) => r.anno).map((r) => r.anno))].sort((a, b) => a - b);
const serieAnnuale = anni.map((anno) => {
  const lista = valide.filter((r) => r.anno === anno);
  const aspetti = {};
  for (const a of tax.aspetti) {
    const c = { positive: 0, negative: 0, neutral: 0 };
    for (const r of lista) {
      const x = r.aspects.find((y) => y.aspect === a.aspect);
      if (x) c[x.sentiment]++;
    }
    aspetti[a.aspect] = c;
  }
  const s = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const r of lista) s[r.overall_sentiment]++;
  return { anno, recensioni: lista.length, sentiment_complessivo: s, aspetti };
});

// --- segnalazioni
const segnalate = tutte.filter((r) => r.needs_attention && r.stato !== 'duplicato');
const ORD = { alta: 0, media: 1, bassa: 2 };
const perCategoria = {};
for (const r of segnalate) for (const s of r.segnalazioni) perCategoria[s.categoria] = (perCategoria[s.categoria] ?? 0) + 1;
const perPriorita = { alta: 0, media: 0, bassa: 0 };
for (const r of segnalate) perPriorita[r.priorita]++;
const segnalazioni = {
  totale: segnalate.length,
  pct_sul_totale: pct(segnalate.length, tutte.filter((r) => r.stato !== 'duplicato').length),
  per_priorita: perPriorita,
  per_categoria: perCategoria,
  solo_per_voto_basso: segnalate.filter((r) => r.segnalazioni.length === 0 && r.rating !== null && r.rating <= ctx.voto.basso_fino_a).length,
  con_un_problema_preciso: segnalate.filter((r) => r.segnalazioni.length > 0).length,
  per_periodo: periodi.map((p) => ({
    periodo: p.periodo,
    segnalate: segnalate.filter((r) => nelPeriodo(r, p)).length,
    segnalate_priorita_alta: segnalate.filter((r) => nelPeriodo(r, p) && r.priorita === 'alta').length,
  })),
  elenco: segnalate
    .sort((a, b) => ORD[a.priorita] - ORD[b.priorita] || (b.published_date ?? '').localeCompare(a.published_date ?? ''))
    .map((r) => ({
      review_id: r.review_id,
      published_date: r.published_date,
      rating: r.rating,
      priorita: r.priorita,
      categorie: [...new Set(r.segnalazioni.map((s) => s.categoria))],
      attention_reason: r.attention_reason,
    })),
};

const lingue = {};
for (const r of valide) lingue[r.language] = (lingue[r.language] ?? 0) + 1;
const date = valide.map((r) => r.published_date).filter(Boolean).sort();

// --- l'elenco fisso degli aspetti va rivisto?
// I temi fuori elenco sono la categoria «altro» del sistema. Si confronta la quota
// di recensioni con temi fuori elenco con la linea di base salvata nell'elenco fisso
// (test su due proporzioni, regola dei 2 errori standard) e si cercano i temi fuori
// elenco abbastanza frequenti da meritare un aspetto (almeno il 2% delle recensioni).
// Se una delle due condizioni scatta, l'elenco va rivisto da una persona (nuova versione).
// Dal 17/11 (dopo l'arrivo delle recensioni in inglese e la verifica con Fable):
// - i temi GENERICI non contano: giudizi senza argomento («general satisfaction», «great site», «bello», «ok»),
//   riconosciuti perche' TUTTE le loro parole sono parole di giudizio; «chat cost» o «bots» restano temi;
// - una linea di base per piattaforma e lingua (italiano, inglese), misurata su tutto l'archivio fino a una data;
// - si controllano solo le recensioni pubblicate DOPO quella data (non l'archivio, che contiene la linea di base),
//   e solo con almeno 100 recensioni nel gruppo; «sopra» = almeno 2 errori standard E almeno 5 punti in piu'.
const PAROLE_DI_GIUDIZIO = new Set(('general overall generic satisfaction dissatisfaction satisfied impression impressions initial early first ' +
  'positive negative comment comments short text evaluation recommendation recommend recommended exclamation good great nice cool wow ' +
  'amazing awesome excellent fantastic perfect best love it ok okay so far interesting interest app application site website bello bella ' +
  'top carino carina fantastico fantastica simpatico simpatica ottimo ottima buono buona hope expectation expectations gratitude thanks ' +
  'experience new user users potential enjoyment emoji uncertainty days day quality feedback opinion review rating stars star ' +
  'praise fun funny like liked enjoy enjoying').split(' '));
const temaGenerico = (t) => { const w = String(t).toLowerCase().split(/[^a-zàèéìòù]+/).filter(Boolean); return w.length > 0 && w.every((x) => PAROLE_DI_GIUDIZIO.has(x)); };
const temiVeri = (r) => (r.unmapped ?? []).filter((t) => !temaGenerico(t));
const elencoAspetti = (() => {
  const SCARTO_MINIMO = 5, MIN_DOPO = 100;
  const gruppoDi = (r) => `${r.piattaforma ?? 'non indicata'}|${r.language}`;
  const conFuori = valide.filter((r) => temiVeri(r).length > 0).length;
  const datiFinoAl = String(date[date.length - 1] ?? '').slice(0, 10);
  // misura di oggi per gruppo, su tutto l'archivio: diventa la linea di base quando manca (la scrive il nodo dopo)
  const misura = {};
  for (const r of valide) {
    if (!LINGUE_TEMPO.includes(r.language)) continue;
    const g = gruppoDi(r);
    misura[g] ??= { recensioni: 0, recensioni_con_temi_fuori_elenco: 0 };
    misura[g].recensioni++;
    if (temiVeri(r).length) misura[g].recensioni_con_temi_fuori_elenco++;
  }
  for (const m of Object.values(misura)) m.pct = pct(m.recensioni_con_temi_fuori_elenco, m.recensioni);
  const base = tax.linea_di_base?.per_gruppo ? tax.linea_di_base : null;
  let confronto = null;
  if (base) {
    confronto = Object.entries(base.per_gruppo).map(([g, b]) => {
      const dopo = valide.filter((r) => gruppoDi(r) === g && r.published_date && String(r.published_date).slice(0, 10) > base.dati_fino_al);
      const con = dopo.filter((r) => temiVeri(r).length).length;
      const c = { gruppo: g, recensioni_dopo_la_linea_di_base: dopo.length, pct_dopo: pct(con, dopo.length), pct_linea_di_base: b.pct, sopra_la_linea_di_base: false };
      if (dopo.length < MIN_DOPO) c.esito = `pochi dati: servono almeno ${MIN_DOPO} recensioni pubblicate dopo il ${base.dati_fino_al}`;
      else {
        const t = dueProporzioni(con, dopo.length, b.recensioni_con_temi_fuori_elenco, b.recensioni);
        c.z = t.z;
        c.sopra_la_linea_di_base = t.z >= 2 && c.pct_dopo - b.pct >= SCARTO_MINIMO;
        c.esito = c.sopra_la_linea_di_base ? 'sopra la linea di base' : 'nella norma';
      }
      return c;
    });
  }
  const conteggio = new Map();
  for (const r of valide) for (const u of new Set(temiVeri(r))) conteggio.set(u, (conteggio.get(u) ?? 0) + 1);
  const soglia = Math.max(5, Math.ceil(0.02 * N));
  const candidati = [...conteggio].filter(([, n]) => n >= soglia).sort((a, b) => b[1] - a[1])
    .map(([tema, n]) => ({ tema, recensioni: n, pct: pct(n, N) }));
  const fisso = tax.origine_aspetti === 'elenco fisso';
  return {
    versione: tax.versione_aspetti,
    origine: tax.origine_aspetti,
    recensioni_con_temi_fuori_elenco_pct: pct(conFuori, N),
    misura_per_gruppo: misura,
    dati_fino_al: datiFinoAl,
    linea_di_base_da_misurare: !base,
    confronto_con_la_linea_di_base: confronto,
    soglia_temi_candidati_recensioni: soglia,
    temi_candidati: candidati,
    da_rivedere: fisso && ((confronto ?? []).some((c) => c.sopra_la_linea_di_base) || candidati.length > 0),
    regola: "temi generici esclusi (giudizi senza argomento); per piattaforma e lingua, le recensioni pubblicate dopo la data della linea di base contro la linea di base (almeno 100 recensioni): da rivedere se la quota con temi fuori elenco supera la linea di base di almeno 2 errori standard e di almeno 5 punti, oppure se un tema fuori elenco compare in almeno il 2% delle recensioni",
  };
})();

// --- controllo delle campagne coordinate (senza modello, solo conteggi e test)
// Due recensioni uguali possono voler dire tre cose: la stessa persona che invia due volte
// (duplicato vero, gia' escluso), un testo breve e comune come "Top" (normale), oppure un
// testo lungo e specifico ripetuto da autori diversi in pochi giorni (possibile campagna).
// Qui si cercano:
// A. testi quasi identici: almeno 8 parole, somiglianza di Jaccard sulle terne di parole
//    >= 0,8, pubblicati a non piu' di 14 giorni di distanza;
// B. picchi di recensioni da 1 stella: per ogni piattaforma e ogni giorno, il numero di recensioni da 1 stella
//    contro il ritmo LOCALE (i 30 giorni prima e i 30 dopo, escluso il giorno; test di Poisson a una
//    coda), correzione Benjamini-Hochberg (FDR 10%) su tutti i giorni; conta come picco solo con almeno
//    3 recensioni da 1 stella e se anche la quota di 1 stella del giorno supera quella dei giorni intorno
//    (un giorno con tante recensioni di ogni voto, per esempio dopo un aggiornamento, non e' una campagna).
//    Correzione del 17/11: prima il ritmo era la media di TUTTO l'archivio e di tutte e due le piattaforme;
//    con lo storico Android (2019-2026, volumi cresciuti molto) segnava 16 «picchi», tutti negli anni con
//    piu' recensioni: il confronto era con un ritmo di anni prima, non con quello del momento.
// Il controllo segnala, non esclude: decide chi legge.
const campagne = (() => {
  const grezze = $('Recensioni pronte').all().map((i) => i.json).filter((r) => !r.duplicato_di && !r.vuota);
  const giorno = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
  // A. testi quasi identici
  const parole = (r) => `${r.text || r.title}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const terne = (w) => { const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(' ')); return s; };
  const lunghe = grezze.map((r) => ({ r, w: parole(r) })).filter((x) => x.w.length >= 8 && x.r.published_date).map((x) => ({ r: x.r, t: terne(x.w), g: giorno(x.r.published_date) }));
  const padre = lunghe.map((_, i) => i);
  const radice = (i) => (padre[i] === i ? i : (padre[i] = radice(padre[i])));
  for (let i = 0; i < lunghe.length; i++) for (let j = i + 1; j < lunghe.length; j++) {
    if (Math.abs(lunghe[i].g - lunghe[j].g) > 14) continue;
    let comuni = 0;
    for (const x of lunghe[i].t) if (lunghe[j].t.has(x)) comuni++;
    const unione = lunghe[i].t.size + lunghe[j].t.size - comuni;
    if (unione && comuni / unione >= 0.8) padre[radice(i)] = radice(j);
  }
  const gruppi = new Map();
  lunghe.forEach((x, i) => { const k = radice(i); if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(x.r); });
  const testiQuasiIdentici = [...gruppi.values()].filter((g) => g.length >= 2).map((g) => {
    const d = g.map((r) => r.published_date).sort();
    return {
      recensioni: g.length,
      dal: d[0], al: d[d.length - 1],
      voti: g.map((r) => r.rating),
      piattaforme: [...new Set(g.map((r) => r.piattaforma))],
      review_id: g.map((r) => r.review_id),
      esempio: `${g[0].text || g[0].title}`.slice(0, 160),
    };
  }).sort((a, b) => b.recensioni - a.recensioni);

  // B. picchi di recensioni da 1 stella (per piattaforma, contro il ritmo locale)
  const FINESTRA = 30, MIN_UNA = 3, MIN_INTORNO = 10; // sotto 10 recensioni intorno: pochi dati, il giorno non si mette alla prova
  const codaPoisson = (k, l) => { // P(X >= k) con X ~ Poisson(l)
    if (k <= 0) return 1;
    if (l <= 0) return 0;
    let termine = Math.exp(-l), somma = termine;
    for (let i = 1; i < k; i++) { termine *= l / i; somma += termine; }
    return Math.max(0, 1 - somma);
  };
  const conData = grezze.filter((r) => r.published_date && r.rating !== null);
  const test = [];
  let nGiorni = 0;
  for (const pf of [...new Set(conData.map((r) => r.piattaforma ?? 'non indicata'))].sort()) {
    const perGiorno = new Map();
    for (const r of conData.filter((x) => (x.piattaforma ?? 'non indicata') === pf)) {
      const g = giorno(r.published_date);
      const x = perGiorno.get(g) ?? { tutte: 0, una: 0 };
      x.tutte++; if (r.rating === ctx.voto.minimo) x.una++;
      perGiorno.set(g, x);
    }
    const giorni = [...perGiorno.keys()];
    const primo = Math.min(...giorni), ultimo = Math.max(...giorni);
    nGiorni += ultimo - primo + 1;
    // somme cumulate per contare in fretta le recensioni dei giorni intorno
    const cumUna = [0], cumTutte = [0];
    for (let g = primo; g <= ultimo; g++) {
      const x = perGiorno.get(g) ?? { tutte: 0, una: 0 };
      cumUna.push(cumUna[cumUna.length - 1] + x.una);
      cumTutte.push(cumTutte[cumTutte.length - 1] + x.tutte);
    }
    const somma = (c, a, b) => c[b - primo + 1] - c[a - primo]; // giorni da a a b compresi
    for (let g = primo; g <= ultimo; g++) {
      const x = perGiorno.get(g) ?? { tutte: 0, una: 0 };
      const a = Math.max(primo, g - FINESTRA), b = Math.min(ultimo, g + FINESTRA);
      const giorniIntorno = b - a; // la finestra senza il giorno stesso
      const unaIntorno = somma(cumUna, a, b) - x.una, tutteIntorno = somma(cumTutte, a, b) - x.tutte;
      const atteso = giorniIntorno > 0 ? unaIntorno / giorniIntorno : 0;
      test.push({
        piattaforma: pf, data: new Date(g * 86400000).toISOString().slice(0, 10), una_stella: x.una, recensioni_del_giorno: x.tutte,
        attese_una_stella: Math.round(100 * atteso) / 100, quota_una_stella_intorno: tutteIntorno ? unaIntorno / tutteIntorno : 0,
        p_value: tutteIntorno >= MIN_INTORNO ? codaPoisson(x.una, atteso) : 1,
      });
    }
  }
  const ord = [...test].sort((a, b) => a.p_value - b.p_value);
  let soglia = -1;
  ord.forEach((x, i) => { if (x.p_value <= ((i + 1) / ord.length) * 0.1) soglia = i; });
  ord.forEach((x, i) => { x.significativo_dopo_correzione = i <= soglia; });
  const picchi = test.filter((x) => x.significativo_dopo_correzione && x.una_stella >= MIN_UNA && x.una_stella / x.recensioni_del_giorno > x.quota_una_stella_intorno)
    .map((x) => ({ ...x, quota_una_stella_del_giorno: pct(x.una_stella, x.recensioni_del_giorno), quota_una_stella_intorno: pct(Math.round(1000 * x.quota_una_stella_intorno), 1000), p_value: Number(x.p_value.toPrecision(3)) }));
  const totUna = conData.filter((r) => r.rating === ctx.voto.minimo).length;

  return {
    regole: {
      testi_quasi_identici: 'almeno 8 parole; somiglianza di Jaccard sulle terne di parole >= 0,8; al massimo 14 giorni di distanza',
      picchi_una_stella: `per piattaforma: recensioni da ${ctx.voto.minimo} stella al giorno contro il ritmo dei ${FINESTRA} giorni prima e dopo (Poisson, una coda), Benjamini-Hochberg FDR 10% su ${nGiorni} giorni-piattaforma; solo giorni con almeno ${MIN_UNA} recensioni da ${ctx.voto.minimo} stella e quota di ${ctx.voto.minimo} stella sopra quella dei giorni intorno; giorni con meno di ${MIN_INTORNO} recensioni intorno non messi alla prova (pochi dati)`,
    },
    recensioni_controllate: grezze.length,
    testi_quasi_identici: testiQuasiIdentici,
    giorni_controllati: nGiorni,
    una_stella_al_giorno_in_media: nGiorni ? Math.round((100 * totUna) / nGiorni) / 100 : null,
    picchi_una_stella: picchi,
    // solo giorni che potrebbero essere picchi (almeno MIN_UNA recensioni da 1 stella)
    giorni_piu_vicini_alla_soglia: ord.filter((x) => x.una_stella >= MIN_UNA).slice(0, 3).map((x) => ({ piattaforma: x.piattaforma, data: x.data, una_stella: x.una_stella, attese_una_stella: x.attese_una_stella, p_value: Number(x.p_value.toPrecision(3)) })),
    esito: testiQuasiIdentici.length || picchi.length ? 'da guardare' : 'nessun segnale',
  };
})();

// --- avviso a grappolo: chi gestisce l'app vuole saperlo subito quando poche persone scrivono lo stesso problema
// sulla stessa versione (per esempio «ho pagato ma l'acquisto non e' arrivato»), prima che arrivino i reclami.
// Si contano le recensioni con la stessa segnalazione, sulla stessa piattaforma e sulla stessa versione,
// pubblicate negli ultimi GRAPPOLO_GIORNI giorni. Ne bastano GRAPPOLO_MINIMO: e' un campanello per andare a
// guardare i ticket del servizio clienti, non un test statistico.
// Per ogni grappolo si dice se la versione e' la piu' recente vista nelle recensioni di quella piattaforma
// (l'ultima pubblicata sullo store non la conosciamo: si dice solo quello che si vede).
// Non contano le recensioni sospette di manipolazione ne' i duplicati. L'avviso su Telegram parte solo se nel
// grappolo c'e' almeno una recensione nuova di questo giro (lo decide il nodo Telegram).
const grappoli = (() => {
  const giornoNum = (d) => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000);
  const comeData = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const oggi = cfg.grappolo_oggi ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const fine = giornoNum(oggi), inizio = fine - (cfg.grappolo_giorni - 1);
  const pronte = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));
  const piuRecente = {};
  for (const r of pronte.values()) {
    if (!r.versione) continue;
    const pf = r.piattaforma ?? 'non indicata';
    if (!piuRecente[pf] || ordineVersione(r.versione, piuRecente[pf]) > 0) piuRecente[pf] = r.versione;
  }
  const gruppi = new Map();
  for (const r of valide) {
    const g = r.published_date ? giornoNum(r.published_date) : NaN;
    if (!(g >= inizio && g <= fine)) continue;
    const pf = r.piattaforma ?? 'non indicata', v = r.versione || '';
    const viste = new Set();
    for (const s of r.segnalazioni ?? []) {
      if (viste.has(s.categoria)) continue; // una recensione conta una volta sola per categoria
      viste.add(s.categoria);
      const k = `${pf}|${v}|${s.categoria}`;
      if (!gruppi.has(k)) gruppi.set(k, { piattaforma: pf, versione: v || null, categoria: s.categoria, nome_categoria: s.nome_categoria, recensioni: [] });
      const x = pronte.get(r.review_id) ?? {};
      gruppi.get(k).recensioni.push({ review_id: r.review_id, chiave_store: `${pf}|${x.id_store ?? ''}`, data: r.published_date, voto: r.rating, sintesi: s.sintesi, evidenza: s.evidenza });
    }
  }
  // la stessa persona che scrive due volte (stesso titolo, un testo contenuto nell'altro) conta una volta sola:
  // si tiene la recensione piu' recente. Dubbio sollevato da una verifica alla cieca: la stessa persona che riscrive
  // la sua recensione con una frase in piu' non deve far scattare da sola un avviso.
  const norma = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const g of gruppi.values()) {
    const tenute = [];
    for (const x of [...g.recensioni].sort((a, b) => String(b.data).localeCompare(String(a.data)))) {
      const p = pronte.get(x.review_id) ?? {};
      const t = norma(p.text), ti = norma(p.title);
      const doppia = tenute.find((y) => y.ti === ti && t.length >= 20 && y.t.length >= 20 && (y.t.includes(t) || t.includes(y.t)));
      if (doppia) { doppia.x.contata_anche = [...(doppia.x.contata_anche ?? []), x.review_id]; continue; }
      tenute.push({ x, t, ti });
    }
    g.recensioni = tenute.map((y) => y.x).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }
  const trovati = [...gruppi.values()].filter((g) => g.recensioni.length >= cfg.grappolo_minimo).map((g) => {
    const d = g.recensioni.map((x) => x.data).sort();
    const recente = piuRecente[g.piattaforma] ?? null;
    return {
      ...g,
      quante: g.recensioni.length,
      dal: d[0],
      al: d[d.length - 1],
      versione_piu_recente_vista: recente,
      e_la_versione_piu_recente: g.versione && recente ? ordineVersione(g.versione, recente) === 0 : null,
    };
  }).sort((a, b) => b.quante - a.quante);
  return {
    regola: `almeno ${cfg.grappolo_minimo} recensioni con la stessa segnalazione, stessa piattaforma e stessa versione, pubblicate dal ${comeData(inizio)} al ${comeData(fine)} (${cfg.grappolo_giorni} giorni); escluse le sospette e i duplicati; due recensioni con lo stesso titolo e un testo contenuto nell'altro contano una volta sola (probabilmente la stessa persona)`,
    dal: comeData(inizio),
    al: comeData(fine),
    grappoli: trovati,
  };
})();

// --- confronti tra periodi di calendario: mese per mese e ogni due settimane (lunedi'-domenica).
// Serve a vedere l'andamento («questo mese piu' negative del mese prima?») senza aprire il digest.
// Per tutte le piattaforme insieme e per ciascuna. Per ogni periodo: recensioni, voto medio, sentiment. I periodi
// senza recensioni restano nella serie, cosi' «il periodo prima» e' sempre quello del calendario.
// Confronto con il periodo subito prima sulla quota di recensioni negative: test su due proporzioni solo se tutti
// e due i periodi hanno almeno 20 recensioni (sotto: «pochi dati», numeri senza verdetto); correzione di
// Benjamini-Hochberg (FDR 10%) su tutti i confronti fatti nella stessa serie. Il periodo in corso e' segnato.
const MIN_RECENSIONI_CONFRONTO = 20;
const periodiCalendario = (() => {
  const oggi = cfg.grappolo_oggi ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const giorno = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  const iso = (t) => t.toISOString().slice(0, 10);
  const piuGiorni = (s, n) => { const t = giorno(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); };
  const lunedi = (s) => { const t = giorno(s); return piuGiorni(iso(t), -((t.getUTCDay() + 6) % 7)); };
  const ANCORA = '2020-01-06'; // un lunedi'
  const inizioQuindicina = (s) => {
    const l = lunedi(s);
    const settimane = Math.round((giorno(l) - giorno(ANCORA)) / (7 * 86400000));
    return ((settimane % 2) + 2) % 2 === 0 ? l : piuGiorni(l, -7);
  };
  const tipi = {
    mese: {
      chiave: (d) => String(d).slice(0, 7),
      successivo: (k) => { const [a, m] = k.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; },
      etichetta: (k) => k,
      in_corso: oggi.slice(0, 7),
    },
    // due settimane (lunedi'-domenica) invece di una: con circa 20 recensioni a settimana i confronti
    // settimanali sarebbero quasi sempre «pochi dati». I periodi partono da un
    // lunedi' fisso (6/1/2020), cosi' restano gli stessi da un giro all'altro.
    due_settimane: {
      chiave: (d) => inizioQuindicina(d),
      successivo: (k) => piuGiorni(k, 14),
      etichetta: (k) => `${k} / ${piuGiorni(k, 13)}`,
      in_corso: inizioQuindicina(oggi),
    },
  };
  const serie = (lista, tipo) => {
    const T = tipi[tipo];
    const conData = lista.filter((r) => r.published_date && String(r.published_date).slice(0, 10) <= oggi);
    if (!conData.length) return [];
    const gruppi = new Map();
    for (const r of conData) {
      const k = T.chiave(r.published_date);
      if (!gruppi.has(k)) gruppi.set(k, []);
      gruppi.get(k).push(r);
    }
    const prima = [...gruppi.keys()].sort()[0];
    const primaData = conData.map((r) => String(r.published_date).slice(0, 10)).sort()[0];
    const periodi = [];
    for (let k = prima; k <= T.in_corso; k = T.successivo(k)) {
      const l = gruppi.get(k) ?? [];
      const neg = l.filter((r) => r.overall_sentiment === 'negative').length;
      // il primo periodo e' incompleto se i dati partono dopo il suo inizio (es. archivio dal 7/6, mese da 1/6)
      const inizioPeriodo = tipo === 'mese' ? `${k}-01` : k;
      periodi.push({
        periodo: T.etichetta(k),
        in_corso: k === T.in_corso,
        dati_solo_dal: k === prima && primaData > inizioPeriodo ? primaData : null,
        recensioni: l.length,
        voto_medio: media(l.filter((r) => r.rating !== null).map((r) => r.rating)),
        positive: l.filter((r) => r.overall_sentiment === 'positive').length,
        negative: neg,
        miste: l.filter((r) => r.overall_sentiment === 'mixed').length,
        neutre: l.filter((r) => r.overall_sentiment === 'neutral').length,
        pct_negative: pct(neg, l.length),
      });
    }
    const confronti = [];
    periodi.forEach((p, i) => {
      if (i === 0) return;
      const q = periodi[i - 1];
      const c = { periodo_prima: q.periodo, pct_negative_prima: q.pct_negative, differenza_punti: p.pct_negative !== null && q.pct_negative !== null ? Math.round(10 * (p.pct_negative - q.pct_negative)) / 10 : null };
      if (p.recensioni >= MIN_RECENSIONI_CONFRONTO && q.recensioni >= MIN_RECENSIONI_CONFRONTO) {
        Object.assign(c, dueProporzioni(p.negative, p.recensioni, q.negative, q.recensioni));
        c.p_value = Number(c.p_value.toPrecision(3));
        confronti.push(c);
      } else {
        c.esito = 'pochi dati';
      }
      p.confronto = c;
    });
    benjaminiHochberg(confronti);
    for (const c of confronti) c.esito = c.significativo ? 'oltre il rumore' : 'entro il rumore';
    return periodi;
  };
  const piattaforme = [...new Set(valide.map((r) => r.piattaforma ?? 'non indicata'))].sort();
  // iOS e Android sempre separati: una serie «tutte» mescolerebbe l'andamento con il cambio di composizione
  // (per esempio quando arriva lo storico di una sola piattaforma). Dubbio della verifica alla cieca del 16/11.
  // e, dal 17/11, italiano e inglese separati: stessa ragione (la quota di inglese cambia nel tempo)
  const perTipo = (tipo) => piattaforme.flatMap((pf) => LINGUE_TEMPO.map((lingua) => ({ piattaforma: pf, lingua, periodi: serie(valide.filter((r) => (r.piattaforma ?? 'non indicata') === pf && r.language === lingua), tipo) }))).filter((s) => s.periodi.length);
  return {
    regola: `serie separate per piattaforma e per lingua (italiano, inglese); quota di recensioni negative di ogni periodo contro il periodo subito prima; test su due proporzioni solo con almeno ${MIN_RECENSIONI_CONFRONTO} recensioni in tutti e due i periodi, correzione Benjamini-Hochberg (FDR 10%) per serie; periodi di due settimane da lunedi' a domenica, a partire dal 6/1/2020; il periodo in corso e' incompleto`,
    oggi,
    mesi: perTipo('mese'),
    due_settimane: perTipo('due_settimane'),
  };
})();

const aggregazione = {
  meta: {
    generato_il: new Date().toISOString(),
    modello: cfg.model,
    file_input: cfg.input_file,
    righe_nel_file: fileInfo.righe_nel_file,
    recensioni_in_output: tutte.length,
    recensioni_aggregate: N,
    escluse_dall_aggregazione: {
      duplicati: tutte.filter((r) => r.stato === 'duplicato').length,
      vuote: tutte.filter((r) => r.stato === 'vuota').length,
      analisi_fallita: tutte.filter((r) => r.stato === 'fallita').length,
      sospette_di_manipolazione: tutte.filter((r) => r.sospetta && r.stato !== 'duplicato').length,
    },
    prima_data: date[0] ?? null,
    ultima_data: date[date.length - 1] ?? null,
    elenco_aspetti: elencoAspetti,
    granularita: cfg.granularita,
    regola_periodi: `unita' di tempo (${cfg.granularita}) di pubblicazione unite finche' ogni periodo ha almeno ${cfg.min_reviews_per_period} recensioni`,
    regola_versioni: `statistiche per versione solo con almeno ${cfg.min_reviews_per_version} recensioni; l'ultima versione con abbastanza recensioni e' confrontata con tutte le precedenti della stessa piattaforma`,
    definizioni: {
      menzioni: "recensioni che esprimono un giudizio sull'aspetto (al massimo 1 per recensione)",
      pct_recensioni_che_lo_apprezzano: "recensioni con giudizio positivo sull'aspetto / recensioni aggregate del periodo x 100",
      pct_recensioni_che_lo_criticano: "recensioni con giudizio negativo sull'aspetto / recensioni aggregate del periodo x 100",
      pct_positive_su_menzioni: "giudizi positivi / menzioni x 100",
      pct_negative_su_menzioni: "giudizi negativi / menzioni x 100",
      saldo: '(positive - negative) / menzioni, da -1 a +1',
      piu_apprezzati: 'ordinati per numero di recensioni che apprezzano l\'aspetto',
      piu_criticati: 'ordinati per numero di recensioni che criticano l\'aspetto',
      per_tasso: `ordinati per quota sulle menzioni, solo aspetti con almeno ${minM} menzioni`,
      per_lingua: 'ogni lingua con almeno 15 recensioni contro tutte le altre, quota di recensioni negative o miste; significativo dopo Benjamini-Hochberg (FDR 10%)',
      andamento: 'ultimo periodo contro i precedenti; significativo = test su due proporzioni con correzione Benjamini-Hochberg (FDR 10%)',
    },
  },
  sentiment_complessivo: contaSentiment(valide),
  voto_medio: media(valide.filter((r) => r.rating !== null).map((r) => r.rating)),
  lingue,
  per_lingua: perLingua,
  aspetti: Object.values(statTotali),
  classifiche,
  periodi,
  andamento,
  per_piattaforma: perPiattaforma,
  serie_annuale: serieAnnuale,
  segnalazioni,
  controllo_campagne: campagne,
  avviso_a_grappolo: grappoli,
  periodi_di_calendario: periodiCalendario,
};

return [{ json: { aggregazione, info_analisi: infoAnalisi } }];
