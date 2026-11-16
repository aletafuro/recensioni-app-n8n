// CONFIGURAZIONE
// Legge i parametri dalle variabili d'ambiente (docker-compose.yml / .env).
// Nessun valore e' scritto nel workflow: chi lo esegue su un'altra macchina
// cambia solo il file .env.
// impostazioni: prima APP_<nome> (quando questo progetto convive con altri nello
// stesso n8n), poi <nome> (quando gira da solo con il suo docker-compose)
const env = (k) => $env['APP_' + k] ?? $env[k];
const numero = (v, predefinito) =>
  v === undefined || v === null || v === '' || isNaN(Number(v)) ? predefinito : Number(v);

if (!$env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY mancante: copia .env.example in .env e inserisci la chiave');
}

// avvio programmato (ogni lunedi'): in quel caso si scaricano sempre le recensioni nuove dallo store
let programmato = false;
try { programmato = $('Ogni lunedi').isExecuted === true; } catch (e) { programmato = false; }

return [{
  json: {
    avvio: programmato ? 'programmato' : 'manuale',
    // scaricare dal feed dell'App Store le recensioni nuove e aggiungerle all'archivio (il file di input)?
    scarica_store: programmato || String(env('SCARICA_STORE') || '').toLowerCase() === 'true',
    app_store_id: env('APP_STORE_ID') || '',
    store_paese: env('STORE_PAESE') || 'it',
    // Android: nome del pacchetto su Google Play e lingue da tenere (l'API non dice il paese, solo la lingua)
    play_package: env('GOOGLE_PLAY_PACKAGE') || '',
    play_lingue: String(env('PLAY_LINGUE') ?? 'it').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    // Android, storico: spazio di Cloud Storage dei report della Play Console (anche nella forma gs://nome/reviews/)
    play_bucket: String(env('GOOGLE_PLAY_BUCKET') || '').replace(/^gs:\/\//, '').split('/')[0],
    input_file: env('INPUT_FILE') || '/files/input/recensioni_inventate.csv',
    // contesto del dominio: chi e' recensito, chi legge, categorie di segnalazione
    context_file: env('CONTEXT_FILE') || '/files/contesto/contesto.json',
    output_dir: (env('OUTPUT_DIR') || '/files/output').replace(/\/+$/, ''),
    model: env('LLM_MODEL') || 'gpt-4.1-mini',
    base_url: (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    // 0 = tutte le recensioni; un numero > 0 = campione deterministico per le prove
    limit: numero(env('LIMIT'), 0),
    // recensioni per chiamata al modello nell'analisi
    batch_size: numero(env('BATCH_SIZE'), 5),
    // recensioni lette per far emergere gli aspetti
    discovery_sample: numero(env('DISCOVERY_SAMPLE'), 240),
    // minimo di recensioni per periodo nell'andamento nel tempo
    min_reviews_per_period: numero(env('MIN_REVIEWS_PER_PERIOD'), 100),
    // elenco fisso degli aspetti: se il file esiste si usa quello e la scoperta
    // degli aspetti si salta; RISCOPRI_ASPETTI=true forza una nuova scoperta
    aspects_file: env('ASPECTS_FILE') || '/files/aspetti/aspetti_fissi.json',
    // solo per le prove: fa partire la revisione dell'elenco anche senza segnale
    forza_revisione_elenco: String(env('FORZA_REVISIONE_ELENCO') || '').toLowerCase() === 'true',
    riscopri_aspetti: String(env('RISCOPRI_ASPETTI') || '').toLowerCase() === 'true',
    // unita' di tempo dell'andamento: anno, trimestre o mese (le unita' con poche
    // recensioni vengono unite alle successive fino al minimo qui sopra)
    granularita: ['anno', 'trimestre', 'mese'].includes(env('GRANULARITA')) ? env('GRANULARITA') : 'anno',
    // minimo di recensioni perche' una versione dell'app abbia statistiche proprie
    min_reviews_per_version: numero(env('MIN_REVIEWS_PER_VERSION'), 30),
    // avviso a grappolo: almeno GRAPPOLO_MINIMO recensioni con la
    // stessa segnalazione, sulla stessa piattaforma e versione, negli ultimi GRAPPOLO_GIORNI giorni.
    // GRAPPOLO_OGGI (AAAA-MM-GG) sposta la data di riferimento: serve solo alle prove su dati vecchi.
    grappolo_minimo: numero(env('GRAPPOLO_MINIMO'), 3),
    grappolo_giorni: numero(env('GRAPPOLO_GIORNI'), 7),
    grappolo_oggi: /^\d{4}-\d{2}-\d{2}$/.test(String(env('GRAPPOLO_OGGI') ?? '')) ? env('GRAPPOLO_OGGI') : null,
    // minimo di menzioni per entrare nelle classifiche "per tasso"
    min_mentions_rate_ranking: numero(env('MIN_MENTIONS_RATE_RANKING'), 30),
    // prezzi del modello in dollari per milione di token (listino da verificare quando cambia)
    prezzo_input_usd_per_milione: numero(env('PREZZO_INPUT_USD_PER_MILIONE'), 0.4),
    prezzo_output_usd_per_milione: numero(env('PREZZO_OUTPUT_USD_PER_MILIONE'), 1.6),
    seed: 42,
    started_at: new Date().toISOString(),
  },
}];
