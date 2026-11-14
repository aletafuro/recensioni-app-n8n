"""Misura un gold set su un giro qualsiasi, con le stesse definizioni del nodo n8n "Calcola metriche".

Serve per il gold set B (di controllo) e per confrontare due giri (prima e dopo una correzione)
sulle stesse recensioni. Controllo incrociato: sul gold set A deve dare gli stessi numeri di n8n.

Uso:
  python valutazione/misura_gold.py GOLD.csv CARTELLA_OUTPUT [CARTELLA_OUTPUT_2]
Con due cartelle confronta i due giri (z su due proporzioni: approssimazione prudente, i giri sono
sulle stesse recensioni).
"""
import csv
import json
import math
import sys
from pathlib import Path


def leggi_jsonl(p):
    return {json.loads(l)["review_id"]: json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()}


def wilson(k, n):
    if not n:
        return None
    z, p = 1.96, k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return round(100 * max(0, c - m), 1), round(100 * min(1, c + m), 1)


def misura(gold, cartella):
    ris = leggi_jsonl(Path(cartella) / "recensioni_analizzate.jsonl")
    dia = leggi_jsonl(Path(cartella) / "recensioni_diagnostica.jsonl")
    et = ["positive", "mixed", "negative", "neutral"]
    conf = {a: {b: 0 for b in et} for a in et}
    ok = ok_l = tp = fp = fn = s_ok = s_n = 0
    stp = sfp = sfn = 0
    n = 0
    for g in gold:
        r = ris.get(g["review_id"])
        if not r:
            continue
        n += 1
        att = g["overall_sentiment"].strip()
        conf[att][r["overall_sentiment"]] += 1
        ok += att == r["overall_sentiment"]
        ok_l += g["language"].strip() == r["language"]
        asp = {}
        for p in [x.strip() for x in g["aspects"].split(";") if x.strip()]:
            a, s = [y.strip() for y in p.split(":")]
            asp[a] = s
        sis = {a["aspect"]: a["sentiment"] for a in r["aspects"]}
        comuni = [a for a in asp if a in sis]
        tp += len(comuni)
        fp += len([a for a in sis if a not in asp])
        fn += len([a for a in asp if a not in sis])
        for a in comuni:
            s_n += 1
            s_ok += asp[a] == sis[a]
        sg = bool([c for c in g["attention_categories"].split(";") if c.strip()])
        ss = len(dia.get(g["review_id"], {}).get("segnalazioni", [])) > 0
        stp += sg and ss
        sfp += (not sg) and ss
        sfn += sg and not ss
    po = ok / n
    pe = sum(sum(conf[a].values()) / n * sum(conf[b][a] for b in et) / n for a in et)
    prec = tp / (tp + fp) if tp + fp else None
    rich = tp / (tp + fn) if tp + fn else None
    return {
        "n": n,
        "sentiment": (ok, n, round(100 * ok / n, 1), wilson(ok, n), round((po - pe) / (1 - pe), 2)),
        "lingua": (ok_l, n, round(100 * ok_l / n, 1)),
        "aspetti_precisione": (tp, tp + fp, round(100 * prec, 1) if prec is not None else None),
        "aspetti_richiamo": (tp, tp + fn, round(100 * rich, 1) if rich is not None else None),
        "aspetti_f1": round(100 * 2 * prec * rich / (prec + rich), 1) if prec and rich else None,
        "sentiment_aspetti_comuni": (s_ok, s_n, round(100 * s_ok / s_n, 1) if s_n else None),
        "segnalazioni_precisione": (stp, stp + sfp, round(100 * stp / (stp + sfp), 1) if stp + sfp else None),
        "segnalazioni_richiamo": (stp, stp + sfn, round(100 * stp / (stp + sfn), 1) if stp + sfn else None),
    }


def z2(k1, n1, k0, n0):
    if not n1 or not n0:
        return None
    p = (k1 + k0) / (n1 + n0)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0))
    return round((k1 / n1 - k0 / n0) / se, 2) if se else 0.0


gold = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
a = misura(gold, sys.argv[2])
print(json.dumps(a, ensure_ascii=False))
if len(sys.argv) > 3:
    b = misura(gold, sys.argv[3])
    print(json.dumps(b, ensure_ascii=False))
    for k in ["sentiment", "aspetti_precisione", "aspetti_richiamo", "segnalazioni_precisione", "segnalazioni_richiamo"]:
        print(f"{k}: {a[k][0]}/{a[k][1]} -> {b[k][0]}/{b[k][1]}  z = {z2(b[k][0], b[k][1], a[k][0], a[k][1])}")
