"""Confronta due o tre giri sulle stesse recensioni (accordo recensione per recensione).

Uso: python valutazione/confronta_giri.py RIFERIMENTO ALTRO [ALTRO_2 ...]
Per ogni coppia (riferimento, altro): accordo sul sentiment complessivo, accordo sulle coppie
recensione-aspetto (stessa definizione del test di stabilita': coppie presenti in almeno uno dei due,
uguali se l'aspetto c'e' in entrambi con lo stesso giudizio), accordo sulla presenza di segnalazioni.
Serve per la prova sulla contaminazione: gruppi da 5 contro gruppi da 5 (variabilita' normale)
e gruppi da 5 contro una recensione alla volta.
"""
import json
import math
import sys
from pathlib import Path


def carica(d):
    a = {json.loads(l)["review_id"]: json.loads(l) for l in (Path(d) / "recensioni_analizzate.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    g = {json.loads(l)["review_id"]: json.loads(l) for l in (Path(d) / "recensioni_diagnostica.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    return a, g


def accordo(r, x):
    (a1, g1), (a2, g2) = r, x
    ids = sorted(set(a1) & set(a2))
    sent = sum(a1[i]["overall_sentiment"] == a2[i]["overall_sentiment"] for i in ids)
    ug = tot = 0
    for i in ids:
        p = {a["aspect"]: a["sentiment"] for a in a1[i]["aspects"]}
        q = {a["aspect"]: a["sentiment"] for a in a2[i]["aspects"]}
        for k in set(p) | set(q):
            tot += 1
            ug += p.get(k) == q.get(k)
    seg = sum(bool(g1[i]["segnalazioni"]) == bool(g2[i]["segnalazioni"]) for i in ids)
    return {"recensioni": len(ids), "sentiment": (sent, len(ids)), "coppie_aspetto": (ug, tot), "segnalazioni": (seg, len(ids))}


def z(k1, n1, k0, n0):
    p = (k1 + k0) / (n1 + n0)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0))
    return round((k1 / n1 - k0 / n0) / se, 2) if se else 0.0


rif = carica(sys.argv[1])
risultati = {}
for d in sys.argv[2:]:
    risultati[d] = accordo(rif, carica(d))
    r = risultati[d]
    print(d, {k: (f"{v[0]}/{v[1]} = {100 * v[0] / v[1]:.1f}%" if isinstance(v, tuple) else v) for k, v in r.items()})
if len(sys.argv) == 4:
    a, b = risultati[sys.argv[2]], risultati[sys.argv[3]]
    for k in ["sentiment", "coppie_aspetto", "segnalazioni"]:
        print(f"{k}: {sys.argv[3]} contro {sys.argv[2]}: z = {z(b[k][0], b[k][1], a[k][0], a[k][1])}")
