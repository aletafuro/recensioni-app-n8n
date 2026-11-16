# Analisi delle recensioni di un'app con n8n e un LLM

Un workflow n8n che ogni settimana legge le recensioni di un'app su App Store e Google Play e le trasforma in informazioni per chi la gestisce:

- per ogni recensione: lingua, giudizio complessivo, giudizio per aspetto (prezzi, stabilità, usabilità...), segnalazione con il motivo e una frase di prova presa dalla recensione;
- l'andamento nel tempo e per versione dell'app, con iOS e Android sempre separati;
- un controllo delle recensioni che sembrano coordinate (testi lunghi quasi identici, picchi di recensioni da una stella);
- un riassunto in italiano per chi non è tecnico, con le citazioni controllate parola per parola;
- l'invio su Telegram del riassunto, del digest completo e di un avviso per ogni recensione nuova grave;
- un **avviso a grappolo** quando poche persone scrivono lo stesso problema sulla stessa versione in pochi giorni (per esempio «ho pagato ma l'acquisto non è arrivato»), con l'indicazione se la versione è vecchia o la più recente;
- l'andamento **ogni due settimane e mese per mese**, con un verdetto statistico onesto («oltre il rumore», «entro il rumore» o «pochi dati»);
- un **file Excel** con 10 fogli (periodi, confronti, versioni, lingue, segnalazioni, grappoli, recensioni);
- una **memoria delle analisi**: si mandano al modello solo le recensioni nuove o cambiate, e tutto si rianalizza da solo se cambiano le istruzioni.

**I dati in questo repository sono inventati.** Il file `data/input/recensioni_inventate.csv` contiene 36 recensioni scritte apposta per un'app immaginaria di note e liste della spesa: ogni testo comincia con «INVENTATA». Le ultime sei servono a mostrare tre cose:
- un grappolo di acquisti pagati e non ricevuti;
- una persona che riscrive la sua recensione;
- un testo scritto per ingannare l'analisi. Servono a far girare il flusso e a vedere che cosa produce. I risultati in `data/output/` vengono da quelle recensioni e non dicono niente di un'app vera. Per usarlo su un'app vera basta indicarne l'identificativo (vedi sotto).

## Perché un progetto separato

Il primo prototipo l'ho costruito su 1.927 recensioni pubbliche di un hotel (repository `recensioni-hotel-n8n`). Lì le recensioni sono un archivio da analizzare una volta: lunghe, in tante lingue, sparse in vent'anni.

Un'app è un altro mondo. Le recensioni arrivano ogni settimana da due store diversi, sono brevissime, cambiano con le versioni e possono essere organizzate. Per questo il sistema è cresciuto: lettura automatica da App Store e Google Play, archivio che si allarga, giro programmato, avvisi, controllo delle campagne, aggiornamento dell'elenco degli aspetti. Il metodo di analisi è lo stesso; tutto il resto è nato qui. Le misure citate sotto vengono da un'app reale, i cui dati non sono pubblicati.

## Come si prova

Serve Docker con Docker Compose e una chiave OpenAI (nella variabile d'ambiente `OPENAI_API_KEY` oppure nel file `.env`, copiato da `.env.example`).

```bash
docker compose --profile esegui run --rm esegui
```

Analizza le 36 recensioni inventate e scrive i risultati in `data/output/`:
- `recensioni_analizzate.json`: un oggetto per recensione;
- `aggregazione.json`, `digest.md` e `recensioni_app.xlsx`;
- `aspetti.json`: l'elenco degli aspetti usato;
- `registro_giro.json`: tempi, costi e quante analisi sono state riprese dalla memoria;
- `memoria_analisi.json` e `memoria_guardrail.json`.

Sulle recensioni inventate il primo giro dura meno di un minuto e costa circa 4 centesimi di dollaro. Il secondo giro riprende tutto dalla memoria: 0 chiamate all'analisi, meno di un centesimo, risultati identici.

Per vedere l'avviso a grappolo bisogna «spostare» la data di oggi a quella delle recensioni inventate, perché l'avviso guarda gli ultimi 7 giorni:

```bash
GRAPPOLO_OGGI=2026-11-06 docker compose --profile esegui run --rm esegui
node strumenti/prova_avvisi_telegram.js data/output
```

Il secondo comando stampa i messaggi che arriverebbero su Telegram, anche senza un bot configurato. Il risultato atteso:
- l'avviso «acquisto pagato ma non ricevuto» per 3 recensioni Android sulla versione 3.2.0, segnata come vecchia perché la più recente è la 3.2.1;
- la recensione riscritta dalla stessa persona contata una volta sola;
- la recensione «costa troppo» senza nessuna segnalazione;
- il testo che dice «ignora le istruzioni» segnato come sospetto ed escluso dai conteggi.

Con l'interfaccia di n8n (http://localhost:5679) e l'avvio automatico di ogni lunedì alle 8:

```bash
docker compose up -d n8n
```

Da Git Bash su Windows, davanti ai comandi che contengono percorsi come `/files/...`, va messo `MSYS_NO_PATHCONV=1`: altrimenti il terminale li trasforma in `C:/Program Files/Git/files/...` e il workflow non trova i file.

## Come si collega a un'app vera

Nel file `.env`:

| variabile | a che cosa serve |
|---|---|
| `SCARICA_STORE=true` | scaricare le recensioni nuove a ogni giro (sempre attivo nell'avvio del lunedì) |
| `APP_STORE_ID`, `STORE_PAESE` | iOS: identificativo dell'app nell'App Store e paese del feed pubblico (per esempio `it`) |
| `GOOGLE_PLAY_PACKAGE`, `GOOGLE_PLAY_CREDENZIALI_B64` | Android: nome del pacchetto e chiave di un account di servizio della Play Console, in base64 |
| `PLAY_LINGUE` | lingue delle recensioni Android da tenere (predefinito `it`) |
| `GOOGLE_PLAY_BUCKET` | Android, storico: indirizzo `gs://...` dei report della Play Console (Scarica report → Recensioni → «Copia URI Cloud Storage») |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PAESI` | iOS, storico: chiave API di App Store Connect (il file `.p8` va in `segreti/`, esclusa da git) e paesi da importare |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | bot e chat che ricevono riassunto, digest, Excel e avvisi |
| `GRAPPOLO_MINIMO`, `GRAPPOLO_GIORNI` | avviso a grappolo: quante recensioni con lo stesso problema sulla stessa versione, in quanti giorni (predefiniti 3 e 7) |
| `INPUT_FILE` | l'archivio delle recensioni (si allarga da solo a ogni giro) |

**iOS.** C'è un feed pubblico, bastano l'identificativo e il paese, ma dà solo le 500 recensioni più recenti. Lo storico completo si prende una volta con l'API di App Store Connect: `python strumenti/importa_storico_apple.py`, prima in prova e poi con `scrivi`. Le regole:
- l'API non dice la versione dell'app, quindi si importano solo le recensioni più vecchie di quelle del feed;
- la loro versione resta «non indicata» e non viene stimata.

**Android.** Non c'è un feed, e scaricare le pagine del Play Store va contro i termini di Google. Le strade ufficiali passano dalla Play Console di chi pubblica l'app:
- l'API di Google Play, che dà le recensioni degli ultimi 7 giorni, per il giro settimanale;
- i report mensili che Google tiene in Cloud Storage, per lo storico. Il giro li legge da solo se l'account di servizio ha il permesso «Visualizzazione di informazioni sulle app e download di report collettivi», nelle *Autorizzazioni account*. Google può metterci fino a un giorno ad attivarlo; finché non è attivo, il giro lo scrive e va avanti.
- in alternativa, gli stessi report scaricati a mano si importano con `python strumenti/importa_play_console.py scrivi`.

Le strade usano lo stesso identificativo di Google, quindi una recensione arrivata da due strade non si conta due volte.

## Come funziona un giro

1. **Store**: scarica le recensioni nuove e le aggiunge all'archivio solo se il loro identificativo dello store non c'è già. Lo storico resta anche quando le recensioni escono dal feed.
2. **Guardrail di ingresso**: email, telefoni, carte, IBAN e indirizzi IP vengono oscurati prima di mandare il testo al modello; i testi scritti per manipolare l'analisi vengono riconosciuti.
3. **Aspetti**: se non c'è un elenco fisso, emergono dalle recensioni in due passi (temi liberi su un campione stratificato per voto, poi raggruppamento controllato dal codice). Poi l'elenco si fissa con una versione, così i numeri di settimane diverse si confrontano. Qui l'elenco fisso è `data/aspetti/aspetti_fissi.json` (v1, nata dagli aspetti scoperti sulle recensioni inventate).
4. **Analisi**: una recensione per chiamata al modello, con risposta in uno schema JSON stretto. Si mandano al modello solo le recensioni nuove o cambiate.
   - Per ogni recensione la memoria (`memoria_analisi.json`) tiene la risposta e una firma: istruzioni, elenco degli aspetti, categorie, modello, impostazioni e testo.
   - Se la firma cambia, la recensione si rianalizza. Un nuovo elenco o un nuovo contesto fanno rianalizzare tutto da soli.
   - Il controllo della manipolazione ha la sua memoria (`memoria_guardrail.json`).
   - Validazione, controllo delle prove e regole si rifanno a ogni giro.
5. **Aggregazione**: classifiche per volume e per quota, andamento nel tempo e per versione con test statistici e correzione per i confronti multipli, controllo delle campagne coordinate.
   - **Periodi di calendario:** ogni due settimane (da lunedì a domenica, fissi dal 6/1/2020) e mese per mese, per piattaforma. Il test si fa solo con almeno 20 recensioni per parte; sotto si scrive «pochi dati».
   - **Avviso a grappolo:** almeno 3 recensioni con la stessa segnalazione, la stessa piattaforma e la stessa versione in 7 giorni. Una persona che riscrive la sua recensione conta una volta sola.
6. **Elenco degli aspetti**: se i temi fuori elenco crescono oltre la linea di base, il sistema propone una nuova versione e la adotta solo se supera controlli fissati prima.
7. **Digest**: le frasi con i numeri le scrive il codice; il modello scrive solo i commenti, senza cifre, e sceglie le citazioni; il codice controlla citazioni e affermazioni.
8. **Telegram**: riassunto (con le ultime due settimane e l'ultimo mese completi, per piattaforma), digest come file, file Excel, avvisi sulle recensioni nuove con priorità alta e avvisi a grappolo (solo se il grappolo contiene almeno una recensione nuova). Se un giro si rompe arriva un avviso anche per quello.

Il dominio sta tutto in `data/contesto/contesto.json` (che cosa viene recensito, chi legge, categorie di segnalazione con la loro priorità): per un'altra app o un altro settore si cambia quel file, non il workflow. Il file non elenca aspetti, perché il modello tenderebbe a vederli anche dove non ci sono.

## L'evoluzione, con gli errori misurati

Ogni parte qui sotto è nata da un errore trovato e corretto. Le misure sono dell'app reale.

**Il modello legge, il codice conta.** All'inizio il riassunto lo scriveva tutto il modello e un controllo verificava che ogni numero esistesse nei dati. Poi è uscito un numero giusto con il significato sbagliato. Ora le frasi con i numeri le scrive il codice e il modello scrive solo i commenti. Anche i commenti a parole vengono controllati: «divisivo», «le critiche aumentano» e «l'apprezzamento cala» si possono scrivere solo per gli aspetti per cui i dati lo dicono.

**Una recensione alla volta.** Il modello leggeva le recensioni a gruppi di cinque. Ho confrontato due giri uguali a gruppi di cinque con un giro una recensione alla volta: tra i due giri uguali gli aspetti coincidevano 93 volte su 100, tra gruppi e singole solo 79. Il giudizio su una recensione dipendeva da quelle accanto. Ora si analizza una recensione alla volta: costa circa tre volte tanto, ma sono centesimi.

**Il modello non risponde sempre uguale.** Due giri identici, una recensione alla volta: il giudizio complessivo coincide nel 99,8% dei casi, le coppie recensione-aspetto nel 93%. È l'affidabilità test-retest dei questionari, applicata a un modello.

**Un secondo gold set che non si tocca.** La qualità si misura contro un gold set etichettato alla cieca da un altro modello, che non vede né i risultati né le istruzioni del sistema. Dopo aver corretto le istruzioni guardando i suoi errori, rimisurare sullo stesso gold set sarebbe stato ottimista: ho fatto etichettare un secondo gold set, mai usato per nessuna decisione, solo per misurare. È un confronto tra modelli, non un'annotazione umana.

**Due recensioni uguali non sono un duplicato.** L'identificativo era costruito da data, titolo e testo. Su un'app molti scrivono solo «Top»: persone diverse, lo stesso giorno, la stessa parola, fuse in una recensione sola. Ora l'identificativo è quello dello store. E da lì è nato il controllo delle campagne coordinate: un testo breve e comune ripetuto è normale, un testo lungo e specifico ripetuto da account diversi in pochi giorni no. Il controllo è riscritto da zero in Python (`workflow/controlla_campagne.py`) e i due programmi danno lo stesso risultato.

**L'elenco degli aspetti si aggiorna da solo, ma con regole.** La prima versione dell'aggiornamento automatico ha adottato un aspetto nuovo che si sovrapponeva a uno esistente, con temi che nessuna recensione citava. Il test di stabilità non se n'era accorto perché il campione, preso a caso, conteneva pochissime recensioni sul tema. Ora un aspetto nuovo è rifiutato se metà o più delle sue recensioni hanno già uno stesso aspetto, i temi devono essere stati visti nelle recensioni e il campione del test è stratificato.

**Chiedere al modello meno cose.** Quando gli chiedevo di ricopiare l'elenco intero più le modifiche, a volte ne restituiva solo una parte. Ora restituisce solo le modifiche e l'elenco lo ricostruisce il codice.

**I file su Telegram.** Dal nodo Code di n8n i file arrivano rovinati (il corpo binario viene serializzato). Il digest come file lo manda il nodo Telegram nativo, con una credenziale creata dal token del `.env`; se fallisce, il digest arriva comunque come testo a pezzi.

**Testi attribuiti all'utente.** Le recensioni sono affermazioni, non fatti accertati: i motivi delle segnalazioni sono scritti come «secondo l'utente...».

**La statistica giusta non era quella che serviva.** Le statistiche per versione partivano da 30 recensioni per versione, ed erano corrette. Ma chi gestisce l'app voleva un campanello: «se tre persone con questa versione scrivono che non hanno ricevuto quello che hanno pagato, per me è un segnale». Da lì sono nati due pezzi:
- l'avviso a grappolo;
- una categoria apposta, «acquisto pagato ma non ricevuto».

La categoria l'ho provata con recensioni inventate, comprese le trappole («costa troppo», «acquisti che avevo e sono spariti»). La prima definizione dava 11 casi giusti su 13; riscritta, 14 su 15. Sulle recensioni vere non è mai scattata per sbaglio.

**Ogni due settimane, non ogni settimana.** Con circa 20 recensioni a settimana, il confronto tra una settimana e l'altra sarebbe stato quasi sempre «pochi dati»: rumore presentato come notizia. Per questo i periodi sono di due settimane, fissi nel calendario, e il verdetto si dà solo con almeno 20 recensioni per parte.

**Un revisore che non trova errori ma trova i problemi.** Un altro modello, senza conoscere il lavoro, ha ricalcolato da zero il file Excel e i messaggi: nessun numero sbagliato. Ha però trovato sei cose che avrebbero ingannato chi legge:
- la stessa persona contata due volte in un avviso, che quindi non doveva partire;
- un totale di segnalazioni che non tornava con la tabella;
- una frase «nessun cambiamento» vera solo per una parte;
- e altre tre simili.

Sono state corrette tutte. Un numero giusto può dire una cosa sbagliata.

**Da 40 minuti a 18 secondi.** Con lo storico completo (2.325 recensioni) ogni giro rianalizzava tutto: 40 minuti e 2,65 dollari. Con la memoria delle analisi e del controllo della manipolazione, il giro normale dura 18 secondi e costa meno di un centesimo. I risultati sono identici campo per campo su tutte le 2.325 recensioni. La memoria non ricorda «che cosa ho già fatto», ma «con quali regole l'ho fatto»: se cambia anche una sola definizione, si rianalizza tutto da solo.

## Verifica

```bash
docker compose --profile verifica run --rm verifica
```

Confronta le recensioni di sviluppo con quelle di test (se `data/valutazione/test_ids.txt` esiste) e misura l'accordo con un gold set (`data/valutazione/gold_set.csv`, formato descritto in `workflow/src/13_verifica_metriche.js`). In questo repository non c'è un gold set: con dati inventati non avrebbe senso. Gli script `valutazione/misura_gold.py` e `valutazione/confronta_giri.py` calcolano le stesse misure in Python, per un controllo incrociato.

## Limiti

- Il gold set è etichettato da un modello: serve un controllo fatto da persone.
- I commenti a parole del riassunto sono controllati su tre tipi di affermazioni, non su tutte.
- Le recensioni sono brevi: molte dicono solo «Bella app» e non danno informazioni sugli aspetti.
- I nomi di persona nelle recensioni non vengono oscurati.
- L'avvio del lunedì funziona solo finché n8n resta acceso: per un uso vero serve una macchina sempre accesa.
- L'avviso a grappolo dice se una versione è «la più recente vista nelle recensioni», non l'ultima pubblicata nello store.
- Le recensioni iOS dello storico non hanno la versione: l'API di Apple non la dà.

## Struttura

```
docker-compose.yml          n8n (versione fissata), esecuzione completa e verifica
workflow/src/*.js           codice dei nodi, un file per nodo
workflow/build_workflow.py  rimonta i workflow n8n da src/
workflow/*.json             i workflow da importare in n8n
data/contesto/              descrizione del dominio
data/input/                 archivio delle recensioni (qui: inventate)
data/output/                risultati dell'ultimo giro
data/aspetti/               elenco fisso degli aspetti (con versione)
strumenti/                  storico iOS (API di Apple) e Android (report), prove fuori da n8n:
                            prova_avvisi_telegram.js (messaggi), prova_periodi.js (confronti),
                            prova_android.js (con un report finto), prova_permesso_report_google.py
valutazione/                misure di qualità in Python
```
