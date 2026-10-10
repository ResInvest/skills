"""Oś czasu samouczka: rozdziały, plansze, zdania lektora i napisy.

Jeśli w mp3/ jest plik lektora (np. mp3/05_zakup.mp3), czas rozdziału = długość nagrania,
a początki zdań wyznacza wykrywanie ciszy (pauzy między zdaniami). Bez nagrania — szacunek
z liczby znaków (tempo zmierzone na głosie Joniu ≈ 15,5 znaku/s).
Wynik: timing.json (czytany przez nagrywarkę i montaż) i subs.ass (polskie napisy).
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
RATE, GAP = 15.5, 0.35          # znaki/s, pauza między zdaniami (szacunek)
OPEN, CARD, TAIL, OUTRO = 5.0, 3.0, 1.2, 5.5   # plansza otwarcia, plansza rozdziału, oddech po lektorze, plansza końcowa

# zapis fonetyczny dla lektora → zapis w napisach
DISPLAY = [("Res-Inwest e-er-pe", "ResInvest ERP"), ("wu-zet", "WZ"), ("em-em", "MM"), ("pe-de-ef", "PDF"),
           ("ce-es-fau", "CSV"), ("gigadżulach", "GJ"), ("osiemdziesięciu pięciu procent", "85%"),
           ("osiemdziesiąt jeden metrów przestrzennych", "81 MP"),
           ("sześć i pół metra na dwa czterdzieści na dwa i pół metra", "6,5 × 2,40 × 2,5 m"),
           ("trzydzieści trzy setne tony", "0,33 t"), ("trzydziestu dni", "30 dni")]


def display(s):
    for a, b in DISPLAY: s = s.replace(a, b)
    return s


def duration(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def silences(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-af", "silencedetect=n=-35dB:d=0.22", "-f", "null", "-"], capture_output=True, text=True)
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return list(zip(st, en))


def sentence_starts(sents, total, sil):
    """Początki zdań: proporcjonalnie do długości, potem przyciągnięte do najbliższej pauzy w nagraniu."""
    w = [len(s) / RATE + GAP for s in sents]
    k = total / sum(w)
    est, t = [], 0.0
    for x in w: est.append(t); t += x * k
    if not sil: return [round(x, 2) for x in est]
    out = [0.0]
    for e in est[1:]:
        ends = [b for a, b in sil if b > out[-1] + 0.6]
        best = min(ends, key=lambda b: abs(b - e)) if ends else e
        out.append(best if abs(best - e) < 2.5 else e)
    return [round(x, 2) for x in out]


def cues(sent, t0, t1):
    """Dzieli zdanie na napisy ≤ 2 linie po ~44 znaki; czas proporcjonalny do liczby znaków."""
    parts = []
    for s in re.split(r"(?<=[.!?…])\s+", sent.strip()):
        n = -(-len(s) // 80)
        if n <= 1: parts.append(s); continue
        words, size, cur = s.split(), len(s) / n, ""
        for wd in words:
            if cur and len(cur) + len(wd) + 1 > size + 8: parts.append(cur); cur = wd
            else: cur = (cur + " " + wd).strip()
        if cur: parts.append(cur)
    merged = []
    for p in parts:   # krótkie zdanie łączone z poprzednim, jeśli razem mieszczą się w dwóch liniach
        if merged and (len(p) < 28 or len(merged[-1]) < 28) and len(merged[-1]) + len(p) + 1 <= 84: merged[-1] += " " + p
        else: merged.append(p)
    parts = merged
    tot, t, out = sum(len(p) for p in parts), t0, []
    for p in parts:
        d = (t1 - t0) * len(p) / tot
        out.append((t, t + d, p)); t += d
    return out


def wrap2(s):
    if len(s) <= 44: return s
    mid, best = len(s) // 2, None
    for m in re.finditer(" ", s):
        if best is None or abs(m.start() - mid) < abs(best - mid): best = m.start()
    return s[:best] + r"\N" + s[best + 1:]


def ts(x):
    h, x = divmod(x, 3600); m, x = divmod(x, 60)
    return f"{int(h)}:{int(m):02d}:{x:05.2f}"


def main():
    script = json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8"))
    t, chapters, events = OPEN, [], []
    for c in script:
        mp3 = os.path.join(HERE, "mp3", c["file"] + ".mp3")
        has = os.path.exists(mp3)
        sents = c["text"]
        if has:
            dur = duration(mp3); starts = sentence_starts(sents, dur, silences(mp3))
        else:
            dur = sum(len(s) / RATE + GAP for s in sents) - GAP; starts = sentence_starts(sents, dur, None)
        tail = OUTRO if c is script[-1] else TAIL
        ch = {"no": c["no"], "file": c["file"], "title": c["title"], "start": round(t, 2), "card": CARD,
              "voiceAt": round(t + CARD, 2), "voiceDur": round(dur, 2), "mp3": mp3 if has else None,
              "contentDur": round(dur + tail, 2), "end": round(t + CARD + dur + tail, 2),
              "sentences": [{"t": s, "text": x} for s, x in zip(starts, sents)]}
        for i, s in enumerate(ch["sentences"]):
            e = ch["sentences"][i + 1]["t"] - 0.15 if i + 1 < len(sents) else dur
            for a, b, p in cues(display(s["text"]), ch["voiceAt"] + s["t"], ch["voiceAt"] + e):
                events.append((a, b, p))
        chapters.append(ch); t = ch["end"]
    tl = {"fps": 30, "open": OPEN, "total": round(t, 2), "chapters": chapters, "estimated": not all(c["mp3"] for c in chapters)}
    json.dump(tl, open(os.path.join(HERE, "timing.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H50141A16,&H50141A16,1,0,0,0,100,100,0,0,3,14,0,2,160,160,46,238

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    with open(os.path.join(HERE, "subs.ass"), "w", encoding="utf-8") as f:
        f.write(head)
        for a, b, p in events:
            f.write(f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{{\\fad(120,120)}}{wrap2(p)}\n")
    print(f"razem {t/60:.1f} min, rozdziałów {len(chapters)}, napisów {len(events)}, z nagrań: {sum(1 for c in chapters if c['mp3'])}")


if __name__ == "__main__":
    main()
