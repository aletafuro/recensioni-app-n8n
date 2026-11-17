"""Controllo incrociato del controllo delle campagne coordinate.

Rifa' in Python, in modo indipendente dal nodo n8n "Aggregazione", i due controlli:
A. testi quasi identici (>= 8 parole, Jaccard sulle terne di parole >= 0,8, entro 14 giorni);
B. picchi di recensioni da 1 stella (per piattaforma, Poisson una coda contro i 30 giorni prima e dopo,
   Benjamini-Hochberg FDR 10%, almeno 3 da 1 stella e quota sopra quella dei giorni intorno).
Poi confronta con data/output/aggregazione.json.

Uso: python workflow/controlla_campagne.py
"""
import csv
import json
import math
import re
from datetime import date, timedelta
from pathlib import Path

A = Path(__file__).resolve().parent.parent
righe = list(csv.DictReader((A / "data" / "input" / "recensioni_inventate.csv").open(encoding="utf-8")))
# stesse esclusioni del workflow: duplicati veri (stesso id dello store) e recensioni vuote
visti, rec = set(), []
for r in righe:
    if r["id_store"] in visti:
        continue
    visti.add(r["id_store"])
    if not r["text"].strip() and not r["title"].strip():
        continue
    rec.append(r)


def parole(r):
    t = (r["text"].strip() or r["title"].strip()).lower()
    return [w for w in re.sub(r"[^\w]+", " ", t).replace("_", " ").split() if w]


def terne(w):
    return {" ".join(w[i:i + 3]) for i in range(len(w) - 2)}


def giorno(d):
    return date.fromisoformat(d).toordinal()


lunghe = [(r, terne(w), giorno(r["publishedDate"])) for r in rec for w in [parole(r)] if len(w) >= 8]
padre = list(range(len(lunghe)))


def radice(i):
    while padre[i] != i:
        padre[i] = padre[padre[i]]
        i = padre[i]
    return i


for i in range(len(lunghe)):
    for j in range(i + 1, len(lunghe)):
        if abs(lunghe[i][2] - lunghe[j][2]) > 14:
            continue
        a, b = lunghe[i][1], lunghe[j][1]
        u = len(a | b)
        if u and len(a & b) / u >= 0.8:
            padre[radice(i)] = radice(j)
gruppi = {}
for i, x in enumerate(lunghe):
    gruppi.setdefault(radice(i), []).append(x[0])
quasi = sorted([g for g in gruppi.values() if len(g) >= 2], key=len, reverse=True)

# B. picchi di 1 stella (regola del 17/11): per piattaforma, ogni giorno contro i 30 giorni prima e i 30
# dopo (escluso il giorno), Poisson una coda, Benjamini-Hochberg FDR 10% su tutti i giorni-piattaforma;
# picco solo con almeno 3 recensioni da 1 stella e quota di 1 stella sopra quella dei giorni intorno.
FINESTRA, MIN_UNA, MIN_INTORNO = 30, 3, 10  # sotto 10 recensioni intorno: pochi dati


def coda_poisson(k, l):
    if k <= 0:
        return 1.0
    if l <= 0:
        return 0.0
    return max(0.0, 1 - sum(math.exp(-l) * l ** i / math.factorial(i) for i in range(k)))


test, n_giorni, tot_una = [], 0, 0
for pf in sorted({r["piattaforma"] or "non indicata" for r in rec}):
    per_giorno = {}
    for r in rec:
        if (r["piattaforma"] or "non indicata") != pf:
            continue
        g = giorno(r["publishedDate"])
        t, u = per_giorno.get(g, (0, 0))
        per_giorno[g] = (t + 1, u + (r["rating"] == "1"))
    primo, ultimo = min(per_giorno), max(per_giorno)
    n_giorni += ultimo - primo + 1
    tot_una += sum(u for _, u in per_giorno.values())
    for g in range(primo, ultimo + 1):
        t, u = per_giorno.get(g, (0, 0))
        intorno = [per_giorno.get(h, (0, 0)) for h in range(max(primo, g - FINESTRA), min(ultimo, g + FINESTRA) + 1) if h != g]
        una_i, tutte_i = sum(x[1] for x in intorno), sum(x[0] for x in intorno)
        atteso = una_i / len(intorno) if intorno else 0.0
        test.append({"pf": pf, "data": date.fromordinal(g).isoformat(), "una": u, "tutte": t, "atteso": atteso,
                     "quota_intorno": una_i / tutte_i if tutte_i else 0.0, "p": coda_poisson(u, atteso) if tutte_i >= MIN_INTORNO else 1.0})
ordinati = sorted(test, key=lambda x: x["p"])
soglia = -1
for i, x in enumerate(ordinati):
    if x["p"] <= (i + 1) / len(ordinati) * 0.1:
        soglia = i
for i, x in enumerate(ordinati):
    x["sig"] = i <= soglia
picchi = [x for x in test if x["sig"] and x["una"] >= MIN_UNA and x["una"] / x["tutte"] > x["quota_intorno"]]
quota_media = tot_una / len(rec)

print(f"recensioni controllate: {len(rec)}; con almeno 8 parole: {len(lunghe)}")
print(f"gruppi di testi quasi identici: {len(quasi)}")
for g in quasi:
    print("  ", len(g), [r["publishedDate"] for r in g], [r["rating"] for r in g], (g[0]["text"] or g[0]["title"])[:80])
print(f"giorni controllati: {n_giorni}; 1 stella: {tot_una} ({100 * quota_media:.1f}%), {tot_una / n_giorni:.2f} al giorno")
print(f"picchi di 1 stella: {len(picchi)}")
for x in picchi:
    print("  ", x["pf"], x["data"], x["una"], "su", x["tutte"], f"attese {x['atteso']:.2f}", f"quota intorno {100 * x['quota_intorno']:.1f}%", f"p={x['p']:.3g}")
vicini = [x for x in ordinati if x["una"] >= MIN_UNA][:3]
print("giorni piu' vicini alla soglia:", [(x["pf"], x["data"], x["una"], round(x["atteso"], 2), float(f"{x['p']:.3g}")) for x in vicini])

# confronto con il risultato del workflow
agg = A / "data" / "output" / "aggregazione.json"
if agg.exists():
    c = json.loads(agg.read_text(encoding="utf-8")).get("controllo_campagne")
    if c:
        ok = (c["recensioni_controllate"] == len(rec) and len(c["testi_quasi_identici"]) == len(quasi)
              and [(p.get("piattaforma"), p["data"]) for p in c["picchi_una_stella"]] == [(x["pf"], x["data"]) for x in picchi]
              and c["giorni_controllati"] == n_giorni
              and [g["data"] for g in c["giorni_piu_vicini_alla_soglia"]] == [x["data"] for x in vicini])
        print("CONFRONTO CON n8n:", "IDENTICO" if ok else "DIVERSO", json.dumps({k: c[k] for k in ("recensioni_controllate", "giorni_controllati", "esito")}))
