"""Podkład z pliku (np. Epic_Inspiration.mp3) zapętlony na cały samouczek.

Utwór jest przycinany z ciszy na początku i końcu, powtarzany z przenikaniem (crossfade), głośność
sprowadzona do ok. −16 LUFS (ducking pod lektorem robi compose.py). Wynik: music.wav (44,1 kHz, stereo).
python loop_music.py plik.mp3 [--xfade 4]
"""
import argparse, json, os, re, subprocess, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
SR = 44100


def decode(path):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def loudness(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])


def trim(x, thr=10 ** (-45 / 20)):
    env = np.abs(x).max(axis=1)
    idx = np.where(env > thr)[0]
    return x[idx[0]: idx[-1] + 1] if len(idx) else x


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("--xfade", type=float, default=4.0); ap.add_argument("--lufs", type=float, default=-16.0)
    a = ap.parse_args()
    tl = json.load(open(os.path.join(HERE, "timing.json"), encoding="utf-8"))
    total = tl["total"] + 1.0; n = int(total * SR); xf = int(a.xfade * SR)
    seg = trim(decode(a.src)) * 10 ** ((a.lufs - loudness(a.src)) / 20)
    out = np.zeros((n, 2), dtype=np.float32)
    fade_in, fade_out = np.sqrt(np.linspace(0, 1, xf))[:, None], np.sqrt(np.linspace(1, 0, xf))[:, None]
    pos, k = 0, 0
    while pos < n:
        s = seg.copy()
        if k > 0: s[:xf] *= fade_in           # przenikanie z poprzednim powtórzeniem
        s[-xf:] *= fade_out
        m = min(len(s), n - pos); out[pos:pos + m] += s[:m]
        pos += len(s) - xf; k += 1
    f = int(3 * SR); out[-f:] *= np.linspace(1, 0, f)[:, None]
    pk = np.abs(out).max()
    if pk > 0.97: out *= 0.97 / pk
    with wave.open(os.path.join(HERE, "music.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype(np.int16).tobytes())
    print(f"music.wav: {total:.1f} s, powtórzeń utworu: {k}, długość utworu {len(seg) / SR:.1f} s")


if __name__ == "__main__":
    main()
