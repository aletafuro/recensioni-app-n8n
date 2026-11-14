// TELEGRAM: RIASSUNTO, DIGEST E AVVISI
// Alla fine di ogni giro, se TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID sono impostati:
// 1. un messaggio breve con i punti principali (numeri presi dall'aggregazione, scritti dal codice);
// 2. il digest completo come file digest.md (lo manda il nodo Telegram nativo che segue);
// 3. un avviso per ogni recensione NUOVA di questo giro con una segnalazione ad alta priorita'
//    (nuova = id dello store mai visto prima: si sa solo quando il giro scarica dallo store).
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
    const r = await helpers.httpRequest({ method: 'POST', url: api('sendMessage'), body: { chat_id: chat, text: testo.slice(0, 4000), disable_web_page_preview: true }, json: true, timeout: 30000 });
    esiti.push({ tipo: 'messaggio', ok: !!r.ok });
  } catch (e) {
    esiti.push({ tipo: 'messaggio', ok: false, errore: e.message });
  }
}
// --- 1. riassunto breve
const pct = (x) => `${String(x).replace('.', ',')}%`;
const S = A.sentiment_complessivo;
const righe = [
  `Recensioni dell'app: giro del ${new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
  '',
  `${A.meta.recensioni_aggregate} recensioni analizzate (dal ${A.meta.prima_data} al ${A.meta.ultima_data}), voto medio ${String(A.voto_medio).replace('.', ',')}. Positive ${pct(S.positive.pct)}, negative ${pct(S.negative.pct)}.`,
];
if (unione) righe.push(`Nuove recensioni scaricate in questo giro: ${unione.nuove} (iOS ${unione.nuove_ios ?? '-'}, Android ${unione.nuove_android ?? '-'}).`);
righe.push('');
for (const x of fatti.frasi_piattaforme ?? []) righe.push(`- ${x}.`);
if (unione && unione.android && unione.android !== 'ok') righe.push(`(Android: ${unione.android})`);
righe.push('', 'Piu\' criticati:');
for (const x of A.classifiche.piu_criticati.slice(0, 3)) righe.push(`- ${x.nome}: ${x.recensioni_negative} recensioni (${pct(x.pct_recensioni_che_lo_criticano)} del totale)`);
const sig = A.andamento.filter((x) => x.significativo);
righe.push('', sig.length ? `Cambiamenti nel tempo oltre la soglia statistica: ${sig.length} (dettagli nel digest).` : 'Nessun cambiamento nel tempo oltre la soglia statistica.');
righe.push(`Segnalate: ${A.segnalazioni.totale}, di cui ${A.segnalazioni.per_priorita.alta} con priorita' alta.`);
if (fatti.frase_campagne) righe.push('', fatti.frase_campagne);
righe.push('', 'Il digest completo e\' nel file qui sotto.');
await invia(righe.join('\n'));

// --- 2. il digest completo lo manda come file il nodo Telegram nativo (qui sotto): dal nodo Code i file
//        arrivano rovinati (prova del 14/11: "there is no document in the request")

// --- 3. avvisi per le recensioni nuove con priorita' alta
const recensioni = new Map($('Recensioni pronte').all().map((i) => [i.json.review_id, i.json]));
const analisi = $('Valida e completa').all().map((i) => i.json);
const urgenti = analisi.filter((r) => {
  const x = recensioni.get(r.review_id);
  return x && nuove.has(`${x.piattaforma}|${x.id_store}`) && (r.segnalazioni ?? []).some((s) => s.priorita === 'alta');
});
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

// esito scritto accanto agli altri risultati (telegram.json), per controllare che cosa e' partito
const esito = { inviato_il: new Date().toISOString(), avvisi_urgenti: urgenti.length, nuove_recensioni: unione?.nuove ?? null, esiti };
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
return [{
  json: { telegram: 'testi inviati', path: `${cfg.output_dir}/telegram.json`, chat_id: String(chat), ...esito },
  binary: {
    data: { data: b64(digest), mimeType: 'text/markdown', fileName: 'digest.md' },
    esito: { data: b64(JSON.stringify(esito, null, 2)), mimeType: 'application/json', fileName: 'telegram.json' },
  },
}];
