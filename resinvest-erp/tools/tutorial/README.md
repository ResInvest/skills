# Samouczek wideo ResInvest ERP

Pełny samouczek programu (16 rozdziałów, ok. 17 min) w MP4 1920×1080, 30 kl./s. Zawiera:

- jasny motyw „Perła”;
- płynny kursor, podświetlenie kliknięć i jaskrawe strzałki z podpisami;
- plansze rozdziałów i polskie napisy;
- lektora (głos Joniu z ElevenLabs);
- epicki podkład instrumentalny.

## Pliki

| Plik | Rola |
|---|---|
| `script.json` | Tekst lektora: 16 rozdziałów, zdania, opis ekranu. Zapis fonetyczny, np. „Res-Inwest e-er-pe”, „wu-zet”. |
| `timing.py` | Oś czasu (`timing.json`) i napisy (`subs.ass`). Z nagraniami: czas rozdziału = długość MP3, a początki zdań wyznacza wykrywanie pauz. Bez nagrań: szacunek ok. 15,5 znaku/s. W napisach zapis fonetyczny jest zamieniany na właściwy („ResInvest ERP”, „WZ”, „PDF”). |
| `music.py` | Synteza podkładu (`music.wav`): d-moll, 92 BPM; smyczki, ostinato, taiko, blacha, crescendo przed planszami. Bez licencji zewnętrznych. |
| `rec.cjs` | Nagrywarka Playwright. Okno 1600×900 px przy skali interfejsu (DPI) 120 % daje kadr 1920×1080 bez ucinania stron. Klatki kluczowe i zdarzenia trafiają do `cap/NN/`, a akcje są zsynchronizowane ze zdaniami lektora. |
| `compose.py` | Montaż wideo (opis niżej). |

`compose.py` dorysowuje:

- kursor;
- żółtą aureolę i pierścień kliknięcia;
- strzałki i ramki;
- plansze otwarcia, rozdziałów i końcową;
- plakietkę rozdziału.

Następnie wypala napisy, miksuje lektora (loudnorm −16 LUFS) z podkładem przyciszanym o 13 dB pod głosem i koduje H.264 oraz AAC.

## Uruchomienie

Wymagania: Node 22 z Playwright i Chromium, Python 3 z `numpy`, `scipy`, `Pillow`, ffmpeg z libass i libx264 (ścieżka w zmiennej `FFMPEG`).

```bash
npm run build                                  # ResInvest_ERP.html w katalogu projektu
cd tools/tutorial
mkdir -p mp3                                   # 01_wstep.mp3 … 16_zakonczenie.mp3 (nazwy z pola "file" w script.json)
python timing.py                               # oś czasu + napisy
python music.py                                # podkład
node rec.cjs                                   # nagranie wszystkich rozdziałów (albo: node rec.cjs 5 6)
python compose.py --out ResInvest_ERP_samouczek.mp4
python compose.py --chapters 5-6 --scale 0.5 --preset veryfast --out podglad.mp4   # szybki podgląd fragmentu
```

Po podmianie nagrań uruchom ponownie `timing.py` i `rec.cjs`, bo akcje dopasowują się do nowych czasów zdań. Potem uruchom `music.py` (natężenie zależy od osi czasu) i `compose.py`.

## Ustawienia lektora (ElevenLabs)

- Głos: Joniu.
- Model: Multilingual v2.
- Stability 0,55, Similarity 0,80, Style 0,15, Speed 0,95.
- Jeden plik MP3 na rozdział, bez muzyki, z ciszą ≤ 0,5 s na początku i końcu.
