// AGGIORNAMENTO AUTOMATICO DELL'ELENCO DEGLI ASPETTI
// L'elenco fisso non cambia da solo da un giro all'altro, ma non e' chiuso per sempre.
// Se l'aggregazione dice che va rivisto (temi fuori elenco oltre la linea di base, o un
// tema fuori elenco in almeno il 2% delle recensioni), questo nodo:
// 1. chiede al modello una nuova versione: gli aspetti esistenti restano identici e
//    possono solo ricevere temi nuovi; si aggiungono aspetti nuovi solo per temi distinti;
//    i temi che non sono aspetti (giudizi generici come "bella app") vengono scartati con il motivo;
//    Per ogni tema candidato il modello riceve anche le prove: quante recensioni lo citano,
//    quali aspetti esistenti hanno gia' ricevuto quelle recensioni, qualche esempio;
// 2. controlla la proposta con regole fissate prima: aspetti esistenti invariati, nessun
//    tema in due aspetti, ogni tema candidato coperto o scartato, al massimo 5 aspetti nuovi,
//    nessun tema inventato (un aspetto nuovo contiene solo temi visti nelle recensioni),
//    nessun aspetto nuovo sovrapposto: se la meta' o piu' delle sue recensioni ha gia' uno
//    stesso aspetto esistente, il tema fa parte di quell'aspetto e non e' un aspetto nuovo;
// 3. fa un test di stabilita' stratificato: rianalizza con il vecchio e con il nuovo elenco
//    meta' campione a caso e meta' recensioni che citano i temi candidati (e' li' che un
//    aspetto nuovo puo' "rubare" recensioni ai vecchi). Il test va superato in tutti e due gli strati.
//    Sugli aspetti che esistevano gia' l'accordo con il giro corrente deve restare al livello
//    della variabilita' normale del modello (stesso elenco rianalizzato due volte), con una
//    tolleranza di 2 errori standard. Se il nuovo elenco "ruba" recensioni ai vecchi aspetti,
//    l'accordo cala e la proposta viene scartata;
// 4. se tutto passa, prepara la nuova versione (adottata dal giro successivo, che rianalizza
//    lo storico); altrimenti tiene la vecchia e chiede l'intervento di una persona.
// Se la versione in uso non ha ancora una linea di base, la misura in questo giro.
const helpers = this.helpers;
const usoToken = [];
const cfg = $('Configurazione').first().json;
const tax = $('Valida tassonomia').first().json;
const ingresso = $input.first().json;
const A = ingresso.aggregazione;
const ea = A.meta.elenco_aspetti;
const analisi = $('Valida e completa').all().map((i) => i.json);
const recensioni = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));
const valide = analisi.filter((r) => ['ok', 'ritentata'].includes(r.stato) && !r.sospetta);

const rapporto = { versione_in_uso: tax.versione_aspetti, revisione_forzata_per_prova: !!cfg.forza_revisione_elenco && !ea.da_rivedere, controllo: { da_rivedere: ea.da_rivedere, temi_candidati: ea.temi_candidati, confronto_con_la_linea_di_base: ea.confronto_con_la_linea_di_base } };
let nuovoElenco = null;      // contenuto del file della nuova versione, se adottata
let lineaDiBase = null;      // linea di base da scrivere nell'elenco in uso, se mancava

// --- linea di base: se la versione in uso non ce l'ha, si misura adesso
if (tax.origine_aspetti === 'elenco fisso' && !tax.linea_di_base) {
  const con = valide.filter((r) => (r.unmapped ?? []).length > 0).length;
  lineaDiBase = { recensioni_con_temi_fuori_elenco: con, recensioni: valide.length, pct: Math.round((1000 * con) / valide.length) / 10, misurata_il: new Date().toISOString().slice(0, 10), giro: 'primo giro della versione ' + tax.versione_aspetti };
  rapporto.linea_di_base_misurata = lineaDiBase;
}

async function chiama(body) {
  const res = await helpers.httpRequest({
    method: 'POST', url: cfg.base_url + '/chat/completions',
    headers: { Authorization: 'Bearer ' + $env.OPENAI_API_KEY }, body, json: true, timeout: 240000,
  });
  if (res.usage) usoToken.push(res.usage);
  return res.choices?.[0]?.message?.content ?? '';
}

if (tax.origine_aspetti !== 'elenco fisso') {
  rapporto.esito = 'non applicabile: gli aspetti di questo giro vengono dalla scoperta, non da un elenco fisso';
} else if (!ea.da_rivedere && !cfg.forza_revisione_elenco) {
  rapporto.esito = 'nessun aggiornamento: il controllo non e\' scattato';
} else {
  // --- temi candidati: quelli del controllo, oppure i piu' frequenti fuori elenco
  const conteggio = new Map();
  for (const r of valide) for (const u of new Set(r.unmapped ?? [])) conteggio.set(u, (conteggio.get(u) ?? 0) + 1);
  const sogliaMinima = Math.max(3, Math.ceil(0.01 * valide.length));
  const candidati = (ea.temi_candidati.length ? ea.temi_candidati.map((c) => c.tema) : [...conteggio].filter(([, n]) => n >= sogliaMinima).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t));
  // prove per ogni tema: recensioni che lo citano e aspetti esistenti che hanno gia' ricevuto
  const nomeAspetto = new Map(tax.aspetti.map((a) => [a.aspect, a.nome]));
  const conTema = (temi) => valide.filter((r) => (r.unmapped ?? []).some((u) => temi.includes(u)));
  const coPresenza = (lista) => {
    const n = new Map();
    for (const r of lista) for (const a of new Set(r.aspects.map((x) => x.aspect))) n.set(a, (n.get(a) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([aspect, k]) => ({ aspect, recensioni: k, pct: Math.round((1000 * k) / lista.length) / 10 }));
  };
  rapporto.temi_proposti_al_modello = candidati.map((t) => {
    const lista = conTema([t]);
    const esempi = lista.slice(0, 3).map((r) => { const x = recensioni.get(r.review_id); return `${x.title} - ${x.text}`.slice(0, 200); });
    return { tema: t, recensioni: lista.length, aspetti_esistenti_gia_presenti: coPresenza(lista).slice(0, 3), esempi };
  });

  if (!candidati.length) {
    rapporto.esito = 'nessun aggiornamento: nessun tema fuori elenco abbastanza frequente da proporre';
  } else {
    // --- 1. proposta del modello
    const vecchi = tax.aspetti;
    const SYSTEM = `You maintain the FIXED list of aspects used to analyse reviews for ${$('Valida contesto').first().json.lettori_dei_risultati}.
Some topics judged by many reviews are not covered by the list. Propose only the CHANGES, with these rules:
- Existing aspects keep their identifier, name and description: you cannot change or remove them. You may only add candidate topics to their includes (in "added_to_existing").
- Each candidate topic comes with evidence: how many reviews mention it, the share of those reviews that already received each existing aspect, and a few examples.
- If half or more of a topic's reviews already received the same existing aspect, the topic is part of that aspect: add it to that aspect's includes, or discard it. Do not create a new aspect for it.
- Add a new aspect only for a topic that is a distinct theme that the readers can act on, clearly different from every existing aspect. At most 5 new aspects.
- The includes of a new aspect may contain only candidate topics. Do not invent topics that are not in the candidates.
- Overall judgements, positive or negative (for example "general praise", "bad app"), are not aspects: discard them.
- Every candidate topic must end up in exactly one place: "added_to_existing" (with the identifier of the existing aspect), the includes of one of the "new_aspects", or "discarded" with a short reason.
- For new aspects give: aspect (English snake_case), name_it (short, in Italian), description_it (one sentence in Italian saying what it covers and what it does not cover), includes.
- Empty lists are fine: if no change is needed, everything goes in "discarded".`;
    const utente = JSON.stringify({ aspetti_esistenti: vecchi.map((a) => ({ aspect: a.aspect, name_it: a.nome, description_it: a.descrizione, includes: a.temi_raggruppati })), temi_candidati: rapporto.temi_proposti_al_modello });
    // il modello restituisce solo le modifiche; l'elenco completo lo ricostruisce il codice
    // (correzione del 14/11: chiedere di ricopiare tutti gli aspetti esistenti faceva fallire la proposta
    // quando il modello restituiva solo quelli cambiati)
    const SCHEMA = { type: 'object', additionalProperties: false, required: ['added_to_existing', 'new_aspects', 'discarded'], properties: {
      added_to_existing: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['aspect', 'topics'], properties: { aspect: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } } } } },
      new_aspects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['aspect', 'name_it', 'description_it', 'includes'], properties: { aspect: { type: 'string' }, name_it: { type: 'string' }, description_it: { type: 'string' }, includes: { type: 'array', items: { type: 'string' } } } } },
      discarded: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'reason'], properties: { topic: { type: 'string' }, reason: { type: 'string' } } } },
    } };
    let proposta = null;
    try {
      proposta = JSON.parse(await chiama({ model: cfg.model, temperature: 0, seed: cfg.seed, max_tokens: 8000,
        response_format: { type: 'json_schema', json_schema: { name: 'aspects_update', strict: true, schema: SCHEMA } },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: utente }] }));
    } catch (e) {
      rapporto.errore_proposta = e.message;
    }

    // --- 2. controlli sulla proposta
    const problemi = [];
    let elencoProposto = null;
    if (!proposta) problemi.push('proposta del modello non leggibile');
    else {
      const normId = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const normT = (t) => String(t).toLowerCase().trim();
      // temi aggiunti agli aspetti esistenti: l'aspetto deve esistere e i temi devono essere stati visti fuori elenco
      const aggiunte = new Map();
      for (const x of proposta.added_to_existing ?? []) {
        const id = normId(x.aspect);
        if (!vecchi.some((v) => v.aspect === id)) { problemi.push(`temi aggiunti a un aspetto che non esiste: ${x.aspect}`); continue; }
        const temi = (x.topics ?? []).map(normT);
        const inventati = temi.filter((t) => !conteggio.has(t));
        if (inventati.length) problemi.push(`temi mai visti nelle recensioni aggiunti a ${id}: ${inventati.join(', ')}`);
        aggiunte.set(id, [...(aggiunte.get(id) ?? []), ...temi]);
      }
      // aspetti esistenti: identificativo, nome e descrizione restano quelli di prima, ricevono solo i temi
      elencoProposto = vecchi.map((v) => ({ aspect: v.aspect, nome: v.nome, descrizione: v.descrizione, temi_raggruppati: [...new Set([...v.temi_raggruppati, ...(aggiunte.get(v.aspect) ?? [])])] }));
      const nuovi = (proposta.new_aspects ?? []).map((a) => [normId(a.aspect), a]);
      for (const [id] of nuovi) if (vecchi.some((v) => v.aspect === id)) problemi.push(`l'aspetto nuovo ${id} ha lo stesso identificativo di uno esistente`);
      if (nuovi.length > 5) problemi.push(`troppi aspetti nuovi (${nuovi.length}, massimo 5)`);
      rapporto.sovrapposizione_aspetti_nuovi = [];
      for (const [id, p] of nuovi) {
        if (!/^[a-z][a-z0-9_]*$/.test(id)) problemi.push(`identificativo non valido: ${id}`);
        const temi = [...new Set(p.includes.map((t) => String(t).toLowerCase().trim()))];
        elencoProposto.push({ aspect: id, nome: String(p.name_it).trim(), descrizione: String(p.description_it).trim(), temi_raggruppati: temi, nuovo: true });
        // nessun tema inventato: ogni tema di un aspetto nuovo deve essere stato visto fuori elenco
        const inventati = temi.filter((t) => !conteggio.has(t));
        if (inventati.length) problemi.push(`l'aspetto nuovo ${id} contiene temi mai visti nelle recensioni: ${inventati.join(', ')}`);
        // nessuna sovrapposizione: le sue recensioni non devono gia' avere, per la maggior parte, uno stesso aspetto esistente
        const lista = conTema(temi);
        const top = coPresenza(lista)[0] ?? null;
        rapporto.sovrapposizione_aspetti_nuovi.push({ aspect: id, recensioni: lista.length, aspetto_esistente_piu_presente: top });
        if (top && top.pct >= 50) problemi.push(`l'aspetto nuovo ${id} si sovrappone a "${nomeAspetto.get(top.aspect) ?? top.aspect}": ${top.recensioni} delle sue ${lista.length} recensioni (${top.pct}%) hanno gia' quell'aspetto`);
      }
      const visti = new Map();
      for (const a of elencoProposto) for (const t of a.temi_raggruppati) {
        if (visti.has(t) && visti.get(t) !== a.aspect) problemi.push(`il tema "${t}" e' in due aspetti (${visti.get(t)} e ${a.aspect})`);
        visti.set(t, a.aspect);
      }
      const scartati = new Map((proposta.discarded ?? []).map((d) => [String(d.topic).toLowerCase().trim(), String(d.reason).trim()]));
      for (const c of candidati) if (!visti.has(c) && !scartati.has(c)) problemi.push(`il tema candidato "${c}" non e' ne' coperto ne' scartato`);
      if (elencoProposto.length > 20) problemi.push(`elenco troppo lungo (${elencoProposto.length} aspetti, massimo 20)`);
      rapporto.proposta = {
        aspetti_nuovi: nuovi.map(([id, p]) => ({ aspect: id, nome: p.name_it, temi: p.includes })),
        temi_aggiunti_ad_aspetti_esistenti: elencoProposto.filter((a) => !a.nuovo).map((a) => ({ aspect: a.aspect, temi_nuovi: a.temi_raggruppati.filter((t) => !vecchi.find((v) => v.aspect === a.aspect).temi_raggruppati.includes(t)) })).filter((x) => x.temi_nuovi.length),
        temi_scartati: [...scartati].map(([tema, motivo]) => ({ tema, motivo })),
      };
      rapporto.temi_non_aspetti_nuovi = [...scartati.keys()];
      // temi che cambiano davvero l'elenco (entrano in un aspetto): solo loro possono spostare recensioni
      rapporto.temi_che_entrano_nell_elenco = candidati.filter((c) => visti.has(c) && !scartati.has(c));
      // aspetti esistenti che ricevono temi nuovi: per loro un cambiamento e' voluto, non un furto
      rapporto.aspetti_esistenti_che_ricevono_temi = (rapporto.proposta.temi_aggiunti_ad_aspetti_esistenti ?? []).map((x) => x.aspect);
    }

    // la proposta cambia gli aspetti? Se scarta soltanto (es. giudizi generici) gli aspetti restano
    // identici: niente test di stabilita', niente nuova versione, niente rianalisi dello storico
    const cambiaAspetti = !!proposta && ((rapporto.proposta?.aspetti_nuovi ?? []).length > 0 || (rapporto.proposta?.temi_aggiunti_ad_aspetti_esistenti ?? []).length > 0);

    // --- 3. test di stabilita' (solo se la proposta passa i controlli e cambia gli aspetti)
    if (!problemi.length && cambiaAspetti) {
      // campione stratificato: fino a 30 recensioni che citano i temi che ENTRANO nell'elenco
      // (i temi scartati non cambiano nulla) + 30 a caso tra le altre
      const perOrdine = (a, b) => (recensioni.get(a.review_id)?.ordine_hash ?? '').localeCompare(recensioni.get(b.review_id)?.ordine_hash ?? '');
      const temiStrato = rapporto.temi_che_entrano_nell_elenco.length ? rapporto.temi_che_entrano_nell_elenco : candidati;
      const stratoTemi = conTema(temiStrato).sort(perOrdine).slice(0, 30);
      const idStrato = new Set(stratoTemi.map((r) => r.review_id));
      const stratoCaso = valide.filter((r) => !idStrato.has(r.review_id)).sort(perOrdine).slice(0, 30);
      const campione = [...stratoTemi, ...stratoCaso];
      // si controllano gli aspetti esistenti che NON ricevono temi nuovi: devono restare come prima
      const ricevono = new Set(rapporto.aspetti_esistenti_che_ricevono_temi);
      const idVecchi = new Set(tax.aspetti.map((a) => a.aspect).filter((a) => !ricevono.has(a)));
      const payload = (r) => { const x = recensioni.get(r.review_id); return { review_id: r.review_id, rating: x.rating, title: x.title, text: x.text || x.title }; };
      // istruzioni dell'analisi con un elenco diverso: si sostituisce solo la parte degli aspetti
      const istruzioniCon = (elenco) => {
        const testo = elenco.map((a) => `- ${a.aspect}: ${a.descrizione} Includes: ${a.temi_raggruppati.slice(0, 25).join(', ')}.`).join('\n');
        const system = tax.system_prompt.replace(/Aspects:\n[\s\S]*?\n\nAttention categories:/, `Aspects:\n${testo}\n\nAttention categories:`);
        const body = JSON.parse(JSON.stringify(tax.body_base));
        body.response_format.json_schema.schema.properties.results.items.properties.aspects.items.properties.aspect.enum = elenco.map((a) => a.aspect);
        return { system, body };
      };
      async function rianalizza(elenco) {
        const { system, body } = istruzioniCon(elenco);
        const out = new Map();
        for (let i = 0; i < campione.length; i += cfg.batch_size) {
          const gruppo = campione.slice(i, i + cfg.batch_size);
          try {
            const testo = await chiama({ ...body, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(gruppo.map(payload)) }] });
            for (const g of JSON.parse(testo).results ?? []) out.set(g.review_id, g.aspects ?? []);
          } catch (e) { /* recensione mancante: conta come disaccordo */ }
        }
        return out;
      }
      // accordo sugli aspetti vecchi: coppie (recensione, aspetto vecchio) presenti in almeno uno dei due,
      // uguali se l'aspetto c'e' in entrambi con lo stesso giudizio
      const accordo = (nuove, gruppo) => {
        let uguali = 0, totale = 0;
        for (const r of gruppo) {
          const prima = new Map(r.aspects.filter((a) => idVecchi.has(a.aspect)).map((a) => [a.aspect, a.sentiment]));
          const dopo = new Map((nuove.get(r.review_id) ?? []).filter((a) => idVecchi.has(a.aspect)).map((a) => [a.aspect, a.sentiment]));
          for (const k of new Set([...prima.keys(), ...dopo.keys()])) { totale++; if (prima.get(k) === dopo.get(k)) uguali++; }
        }
        return { uguali, totale, pct: totale ? Math.round((1000 * uguali) / totale) / 10 : null };
      };
      const rianalisiVecchio = await rianalizza(tax.aspetti);
      const rianalisiNuovo = await rianalizza(elencoProposto);
      // il nuovo elenco non deve far calare l'accordo oltre 2 errori standard rispetto alla variabilita' normale
      // (l'accordo con il vecchio elenco misura la variabilita' normale di questa rianalisi; non e' un test-retest puro,
      // perche' le istruzioni vengono ricostruite: il test-retest vero, due giri identici, e' 93% sulle coppie recensione-aspetto)
      const confronta = (gruppo) => {
        const v = accordo(rianalisiVecchio, gruppo), n = accordo(rianalisiNuovo, gruppo);
        if (!v.totale || !n.totale) return { recensioni: gruppo.length, accordo_rianalizzando_con_il_vecchio_elenco: v, accordo_rianalizzando_con_il_nuovo_elenco: n, z_nuovo_meno_vecchio: null, superato: true, dati_sufficienti: false };
        const p0 = v.uguali / v.totale, p1 = n.uguali / n.totale;
        const pp = (v.uguali + n.uguali) / (v.totale + n.totale);
        const se = Math.sqrt(pp * (1 - pp) * (1 / v.totale + 1 / n.totale));
        const z = se > 0 ? Math.round((100 * (p1 - p0)) / se) / 100 : 0;
        return { recensioni: gruppo.length, accordo_rianalizzando_con_il_vecchio_elenco: v, accordo_rianalizzando_con_il_nuovo_elenco: n, z_nuovo_meno_vecchio: z, superato: z > -2, dati_sufficienti: v.totale >= 20 && n.totale >= 20 };
      };
      const strati = { recensioni_con_temi_candidati: confronta(stratoTemi), recensioni_a_caso: confronta(stratoCaso) };
      rapporto.test_di_stabilita = {
        recensioni_nel_campione: campione.length,
        strati,
        aspetti_controllati: [...idVecchi],
        regola: "superato se, in ciascuno dei due strati, l'accordo sugli aspetti esistenti che non ricevono temi nuovi non scende, con il nuovo elenco, di oltre 2 errori standard rispetto a quello con il vecchio elenco (variabilita' normale del modello). Con un aspetto nuovo servono almeno 20 coppie recensione-aspetto nello strato dei temi: con meno il test non ha la potenza per vedere un furto di recensioni",
        superato: Object.values(strati).every((x) => x.superato),
      };
      for (const [nome, x] of Object.entries(strati)) if (!x.superato) problemi.push(`test di stabilita' non superato (${nome.replace(/_/g, ' ')}): l'accordo sugli aspetti esistenti scende dal ${x.accordo_rianalizzando_con_il_vecchio_elenco.pct}% al ${x.accordo_rianalizzando_con_il_nuovo_elenco.pct}% (z = ${x.z_nuovo_meno_vecchio})`);
      if ((rapporto.proposta.aspetti_nuovi ?? []).length && !strati.recensioni_con_temi_candidati.dati_sufficienti) {
        rapporto.test_di_stabilita.superato = false;
        problemi.push(`test di stabilita' non conclusivo: nello strato dei temi ci sono solo ${strati.recensioni_con_temi_candidati.accordo_rianalizzando_con_il_vecchio_elenco.totale} coppie recensione-aspetto (ne servono almeno 20 per adottare un aspetto nuovo)`);
      }
    }

    // --- 4. decisione
    if (problemi.length) {
      rapporto.esito = 'proposta scartata: resta la versione in uso, serve l\'intervento di una persona';
      rapporto.problemi = problemi;
    } else if (!cambiaAspetti) {
      // stessa versione: si registrano solo i temi che non sono aspetti; la linea di base va rimisurata,
      // perche' quei temi non contano piu' come fuori elenco
      let inUso = null;
      try { inUso = $('Estrai elenco fisso').first().json.data ?? null; } catch (e) { inUso = null; }
      const aggiunti = (rapporto.temi_non_aspetti_nuovi ?? []).filter((t) => !(tax.temi_non_aspetti ?? []).includes(t));
      if (inUso && aggiunti.length) {
        nuovoElenco = {
          ...inUso,
          linea_di_base_temi_fuori_elenco: null, // si rimisura al prossimo giro
          temi_non_aspetti: [...(tax.temi_non_aspetti ?? []), ...aggiunti],
          aggiornamenti_senza_cambio_aspetti: [...(inUso.aggiornamenti_senza_cambio_aspetti ?? []), { data: new Date().toISOString().slice(0, 10), temi_non_aspetti_aggiunti: aggiunti, scartati: rapporto.proposta.temi_scartati }],
        };
        rapporto.esito = `aspetti invariati, resta la versione ${tax.versione_aspetti}: registrati come non aspetti ${aggiunti.join(', ')}; la linea di base si rimisura al prossimo giro`;
      } else {
        rapporto.esito = `aspetti invariati, resta la versione ${tax.versione_aspetti}: i temi candidati sono gia' registrati come non aspetti`;
      }
      rapporto.rianalisi_dello_storico_necessaria = false;
    } else {
      const numero = (parseInt(String(tax.versione_aspetti).replace(/\D/g, ''), 10) || 1) + 1;
      nuovoElenco = {
        versione: 'v' + numero,
        creato_il: new Date().toISOString().slice(0, 10),
        origine: `aggiornamento automatico della ${tax.versione_aspetti}`,
        modifiche_rispetto_alla_versione_precedente: rapporto.proposta,
        controlli_superati: { test_di_stabilita: rapporto.test_di_stabilita },
        linea_di_base_temi_fuori_elenco: null, // si misura al primo giro della nuova versione
        temi_non_aspetti: [...new Set([...(tax.temi_non_aspetti ?? []), ...(rapporto.temi_non_aspetti_nuovi ?? [])])],
        aspetti: elencoProposto.map(({ nuovo, ...a }) => a),
      };
      rapporto.esito = `nuova versione ${nuovoElenco.versione} adottata: la usa il prossimo giro, che rianalizza tutte le recensioni con il nuovo elenco`;
      rapporto.rianalisi_dello_storico_necessaria = true;
    }
  }
}
rapporto.uso_token = usoToken;

return [{ json: { ...ingresso, aggiornamento_elenco: rapporto, nuovo_elenco: nuovoElenco, linea_di_base_misurata: lineaDiBase } }];
