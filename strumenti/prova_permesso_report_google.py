"""Controlla se l'account di servizio puo' leggere i report mensili delle recensioni Android (Cloud Storage).
Legge GOOGLE_PLAY_BUCKET e GOOGLE_PLAY_PACKAGE dal .env e la chiave da segreti/account_servizio_google_play.json.
Non stampa segreti. Uso: python strumenti/prova_permesso_report_google.py"""
import base64, json, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

A = Path(__file__).resolve().parent.parent
env = dict(r.split("=", 1) for r in (A / ".env").read_text(encoding="utf-8").splitlines() if "=" in r and not r.startswith("#"))
BUCKET = env.get("GOOGLE_PLAY_BUCKET", "").strip().replace("gs://", "").split("/")[0]
PACCHETTO = env.get("GOOGLE_PLAY_PACKAGE", "").strip()
acc = json.loads((A / "segreti" / "account_servizio_google_play.json").read_text(encoding="utf-8"))
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
ora = int(time.time())
testa = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
corpo = b64(json.dumps({"iss": acc["client_email"], "scope": "https://www.googleapis.com/auth/devstorage.read_only", "aud": "https://oauth2.googleapis.com/token", "iat": ora, "exp": ora + 3600}).encode())
chiave = serialization.load_pem_private_key(acc["private_key"].encode(), password=None)
firma = b64(chiave.sign(f"{testa}.{corpo}".encode(), padding.PKCS1v15(), hashes.SHA256()))
dati = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": f"{testa}.{corpo}.{firma}"}).encode()
tok = json.load(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=dati), timeout=30))["access_token"]
print("1. accesso a Google: OK")
url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?prefix={urllib.parse.quote('reviews/reviews_' + PACCHETTO + '_')}&maxResults=1000"
try:
    r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": "Bearer " + tok}), timeout=30))
    nomi = sorted(o["name"] for o in r.get("items", []))
    print(f"2. PERMESSO ATTIVO: {len(nomi)} report mensili delle recensioni")
    if nomi:
        print(f"   dal {nomi[0].split('_')[-1][:6]} al {nomi[-1].split('_')[-1][:6]}")
except urllib.error.HTTPError as e:
    print("2. PERMESSO NON ANCORA ATTIVO:", e.code, json.loads(e.read().decode()).get("error", {}).get("message", "")[:160])
