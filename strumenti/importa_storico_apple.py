"""Importa nell'archivio lo storico delle recensioni iOS dall'API di App Store Connect.

Il feed pubblico dell'App Store (usato a ogni giro) da' solo le 500 recensioni piu' recenti, con la versione
dell'app. L'API di App Store Connect da' TUTTE le recensioni, ma senza la versione. Quindi:
- le recensioni che l'archivio ha gia' dal feed restano come sono (con la loro versione);
- si aggiungono solo le recensioni PIU' VECCHIE della recensione piu' vecchia del feed nell'archivio, piu' quelle
  dello stesso giorno che non sono gia' nell'archivio (abbinamento per data, voto e titolo);
- le recensioni piu' recenti continuano ad arrivare dal feed, con la versione: niente doppioni tra le due fonti
  (gli identificativi delle due fonti sono diversi, per questo non si mescolano sulle stesse date);
- la versione delle recensioni importate resta vuota («non indicata»): non si stima dalla data.

Serve nel file .env: APPLE_ISSUER_ID e APPLE_KEY_ID; la chiave in segreti/AuthKey_<APPLE_KEY_ID>.p8.
Facoltativo: APPLE_PAESI (predefinito ITA, come il feed che legge lo store italiano), per esempio ITA,GBR,USA.

Uso:
  python strumenti/importa_storico_apple.py            (mostra cosa aggiungerebbe, non scrive)
  python strumenti/importa_storico_apple.py scrivi     (copia di sicurezza dell'archivio, poi aggiunge)
"""
import base64
import csv
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

A = Path(__file__).resolve().parent.parent
ARCHIVIO = A / "data" / "input" / "recensioni_inventate.csv"
COLONNE = ["id_store", "title", "rating", "travelDate", "publishedDate", "text", "piattaforma", "versione", "paese"]
PAESE = {"ITA": "it", "GBR": "gb", "USA": "us", "ESP": "es", "FRA": "fr", "DEU": "de", "CHE": "ch"}


def leggi_env():
    env = {}
    for riga in (A / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in riga and not riga.lstrip().startswith("#"):
            k, v = riga.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def token(env):
    chiave = serialization.load_pem_private_key((A / "segreti" / f"AuthKey_{env['APPLE_KEY_ID']}.p8").read_bytes(), password=None)
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    ora = int(time.time())
    testa = b64(json.dumps({"alg": "ES256", "kid": env["APPLE_KEY_ID"], "typ": "JWT"}).encode())
    corpo = b64(json.dumps({"iss": env["APPLE_ISSUER_ID"], "iat": ora, "exp": ora + 1200, "aud": "appstoreconnect-v1"}).encode())
    r, s = decode_dss_signature(chiave.sign(f"{testa}.{corpo}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"{testa}.{corpo}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def leggi_api(env, app_id):
    """Tutte le recensioni dell'app. Il server di Apple a volte non risponde: fino a 6 tentativi con attesa crescente."""
    t = token(env)
    url = f"https://api.appstoreconnect.apple.com/v1/apps/{app_id}/customerReviews?limit=200&sort=-createdDate"
    tutte = []
    while url:
        for tentativo in range(6):
            try:
                req = urllib.request.Request(url, headers={"Authorization": "Bearer " + t})
                d = json.load(urllib.request.urlopen(req, timeout=60))
                break
            except urllib.error.HTTPError as e:
                sys.exit(f"Errore dall'API di Apple: {e.code} {e.read().decode()[:300]}")
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(5 * (tentativo + 1))
        else:
            sys.exit("Il server di Apple non risponde dopo 6 tentativi: riprovare piu' tardi.")
        tutte += d["data"]
        url = d.get("links", {}).get("next")
    return tutte


def chiave_contenuto(data, voto, titolo):
    return (str(data)[:10], str(voto).strip(), " ".join(str(titolo).lower().split()))


def main():
    scrivi = len(sys.argv) > 1 and sys.argv[1] == "scrivi"
    env = leggi_env()
    paesi = [p.strip().upper() for p in env.get("APPLE_PAESI", "ITA").split(",") if p.strip()]
    app_id = env.get("APP_STORE_ID", "")
    if not app_id:
        sys.exit("Manca APP_STORE_ID nel file .env (il numero dell'app nell'App Store).")
    archivio = list(csv.DictReader(open(ARCHIVIO, encoding="utf-8", newline="")))
    ios = [r for r in archivio if r["piattaforma"] == "ios"]
    if not ios:
        sys.exit("Nell'archivio non ci sono recensioni iOS dal feed: niente da cui partire.")
    piu_vecchia_feed = min(r["publishedDate"][:10] for r in ios)
    gia = {chiave_contenuto(r["publishedDate"], r["rating"], r["title"]) for r in ios}
    id_gia = {r["id_store"] for r in ios}

    api = leggi_api(env, app_id)
    print(f"Recensioni lette dall'API: {len(api)} (paesi: {dict(Counter(x['attributes'].get('territory') for x in api))})")
    nel_paese = [x for x in api if x["attributes"].get("territory") in paesi]
    print(f"Nei paesi scelti ({','.join(paesi)}): {len(nel_paese)}")
    abbinate = sum(1 for x in nel_paese if chiave_contenuto(x["attributes"]["createdDate"], x["attributes"]["rating"], x["attributes"].get("title") or "") in gia)
    print(f"Gia' nell'archivio dal feed (stessa data, voto e titolo): {abbinate} su {len(ios)} recensioni iOS dell'archivio")

    nuove, saltate_recenti, saltate_doppie = [], 0, 0
    for x in nel_paese:
        a = x["attributes"]
        d = a["createdDate"][:10]
        if d > piu_vecchia_feed:
            saltate_recenti += 1  # periodo coperto dal feed (con la versione): non si mescolano le fonti
            continue
        if x["id"] in id_gia or chiave_contenuto(d, a["rating"], a.get("title") or "") in gia:
            saltate_doppie += 1
            continue
        nuove.append({
            "id_store": x["id"], "title": a.get("title") or "", "rating": str(a["rating"]), "travelDate": "",
            "publishedDate": d, "text": a.get("body") or "", "piattaforma": "ios", "versione": "",
            "paese": PAESE.get(a.get("territory"), str(a.get("territory", "")).lower()),
        })
    print(f"Saltate perche' piu' recenti del {piu_vecchia_feed} (le copre il feed): {saltate_recenti}")
    print(f"Saltate perche' gia' nell'archivio: {saltate_doppie}")
    print(f"DA AGGIUNGERE: {len(nuove)}")
    if nuove:
        date_n = sorted(r["publishedDate"] for r in nuove)
        print(f"  dal {date_n[0]} al {date_n[-1]}")
        print("  per anno:", dict(sorted(Counter(r["publishedDate"][:4] for r in nuove).items())))
        print("  per voto:", dict(sorted(Counter(r["rating"] for r in nuove).items())))
        print("  senza testo:", sum(1 for r in nuove if not r["text"].strip()))
        id_doppi = [k for k, v in Counter(r["id_store"] for r in nuove).items() if v > 1]
        print("  identificativi ripetuti tra le nuove:", len(id_doppi))
    if not scrivi:
        print("\nProva: niente scritto. Per aggiungere: python strumenti/importa_storico_apple.py scrivi")
        return
    copia = A / "data" / "archivio" / f"recensioni_app_prima_dello_storico_apple_{date.today().isoformat()}.csv"
    shutil.copy2(ARCHIVIO, copia)
    with open(ARCHIVIO, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLONNE, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writeheader()
        for r in archivio + nuove:
            w.writerow({c: r.get(c, "") for c in COLONNE})
    print(f"\nScritto: archivio da {len(archivio)} a {len(archivio) + len(nuove)} recensioni. Copia di sicurezza: {copia.relative_to(A)}")


if __name__ == "__main__":
    main()
