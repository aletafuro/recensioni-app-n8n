"""Importa nell'archivio le recensioni Android esportate dalla Play Console (storico).

L'API di Google Play restituisce solo le recensioni degli ultimi 7 giorni: per lo storico servono le
esportazioni mensili della Play Console (Scarica report -> Recensioni), file
reviews_<pacchetto>_<AAAAMM>.csv, codificati in UTF-16.

Uso:
  1. copia i file CSV in data/input/play_console/
  2. python strumenti/importa_play_console.py            (mostra cosa aggiungerebbe, non scrive)
  3. python strumenti/importa_play_console.py scrivi     (aggiunge all'archivio data/input/recensioni_inventate.csv)

Regole:
- l'identificativo e' il reviewId di Google (dal link della recensione, parametro reviewid): e' lo stesso
  che restituisce l'API, quindi una recensione arrivata da tutte e due le strade non si conta due volte;
- si tengono solo le lingue in PLAY_LINGUE (predefinito: it), come nel giro settimanale;
- l'autore non c'e' nei file della Play Console e comunque non servirebbe;
- se una recensione e' stata modificata, la data e' quella dell'ultima modifica (come nell'API).
"""
import csv
import hashlib
import io
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

A = Path(__file__).resolve().parent.parent
CARTELLA = A / "data" / "input" / "play_console"
ARCHIVIO = A / "data" / "input" / "recensioni_inventate.csv"
COLONNE = ["id_store", "title", "rating", "travelDate", "publishedDate", "text", "piattaforma", "versione", "paese"]
LINGUE = [x.strip().lower() for x in os.environ.get("PLAY_LINGUE", "it").split(",") if x.strip()]


def leggi_testo(p):
    dati = p.read_bytes()
    for codifica in ("utf-16", "utf-8-sig", "utf-8"):
        try:
            return dati.decode(codifica)
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"codifica non riconosciuta: {p.name}")


def id_recensione(r):
    link = r.get("Review Link", "") or ""
    rid = parse_qs(urlparse(link).query).get("reviewid", [""])[0]
    if rid:
        return rid
    # senza link: identificativo dal contenuto (data in millisecondi + voto + testo)
    chiave = "|".join([r.get("Review Submit Millis Since Epoch", ""), r.get("Star Rating", ""), r.get("Review Text", "")])
    return "pc:" + hashlib.sha1(chiave.encode("utf-8")).hexdigest()[:16]


def data(r):
    for campo in ("Review Last Update Millis Since Epoch", "Review Submit Millis Since Epoch"):
        v = (r.get(campo) or "").strip()
        if v.isdigit():
            return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    v = (r.get("Review Submit Date and Time") or "").strip()
    return v[:10]


def righe_da_file(p):
    lettore = csv.DictReader(io.StringIO(leggi_testo(p)))
    for r in lettore:
        lingua = (r.get("Reviewer Language") or "").strip().lower()[:2]
        if LINGUE and lingua not in LINGUE:
            continue
        testo = (r.get("Review Text") or "").strip()
        titolo = (r.get("Review Title") or "").strip()
        if not testo and not titolo:
            continue  # solo stelle, senza testo: niente da analizzare
        yield {"id_store": id_recensione(r), "title": titolo, "rating": (r.get("Star Rating") or "").strip(), "travelDate": "",
               "publishedDate": data(r), "text": testo, "piattaforma": "android",
               "versione": (r.get("App Version Name") or "").strip(), "paese": lingua}


def main():
    scrivi = len(sys.argv) > 1 and sys.argv[1] == "scrivi"
    file = sorted(CARTELLA.glob("*.csv")) if CARTELLA.exists() else []
    if not file:
        raise SystemExit(f"nessun file CSV in {CARTELLA}")
    archivio = list(csv.DictReader(ARCHIVIO.open(encoding="utf-8", newline=""))) if ARCHIVIO.exists() else []
    visti = {f"{r['piattaforma']}|{r['id_store']}" for r in archivio}
    nuove = []
    for p in file:
        letti = 0
        for r in righe_da_file(p):
            letti += 1
            k = f"android|{r['id_store']}"
            if k not in visti:
                visti.add(k)
                nuove.append(r)
        print(f"{p.name}: {letti} recensioni con testo nelle lingue {LINGUE}")
    print(f"archivio: {len(archivio)} recensioni; nuove Android da aggiungere: {len(nuove)}")
    if scrivi and nuove:
        with ARCHIVIO.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLONNE, quoting=csv.QUOTE_ALL)
            w.writeheader()
            for r in nuove + archivio:
                w.writerow({c: r.get(c, "") for c in COLONNE})
        print(f"scritto {ARCHIVIO}: {len(nuove) + len(archivio)} recensioni")
    elif not scrivi:
        print("(prova: niente scritto; aggiungi «scrivi» per salvare)")


if __name__ == "__main__":
    main()
