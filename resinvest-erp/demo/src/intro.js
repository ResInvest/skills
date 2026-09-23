/* =========================================================================
   Warstwa I: ekran powitalny (intro) z muzyką

   * Muzyka jest domyślnie WŁĄCZONA i startuje razem z intro (ścieżka dźwiękowa
     filmu z wersji 1.3.0).
   * Przeglądarki blokują autoodtwarzanie dźwięku bez gestu użytkownika. Wtedy
     film gra dalej wyciszony, a PIERWSZE kliknięcie lub klawisz włącza muzykę.
     Blokada nigdy nie zatrzymuje aplikacji.
   * Brak kodeka H.264/AAC → plansza firmowa + krótka muzyka syntezowana Web Audio.
   * „Pomiń intro” (przycisk, Esc, Enter) działa zawsze; twardy limit czasu 14 s.
   ========================================================================= */
(function (root) {
  "use strict";
  const PREF_MUSIC = "riw.demo.music";
  const PREF_INTRO = "riw.demo.intro";
  const DBG = root.RIW_DEBUG = root.RIW_DEBUG || {};

  const ICON_ON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const ICON_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';

  /** Krótki motyw muzyczny syntezowany w przeglądarce (bez plików, bez CDN). */
  function createSynth() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return { start: () => Promise.resolve(false), stop() {}, setMuted() {} };
    let ctx = null, master = null, muted = false;
    const VOL = 0.14;
    const schedule = () => {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 1800;
      filter.connect(master);
      const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
      const t = ctx.currentTime + 0.05;
      chords.forEach((ch, i) => {
        const t0 = t + i * 1.55;
        ch.forEach((f, j) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = j === 0 ? "sine" : "triangle";
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.28, t0 + 0.3);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);
          o.connect(g); g.connect(filter);
          o.start(t0); o.stop(t0 + 2.2);
        });
      });
    };
    return {
      start() {
        try {
          if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : VOL;
            master.connect(ctx.destination);
            schedule();
          }
        } catch (e) { return Promise.resolve(false); }
        const resumed = ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
        // resume() bez gestu potrafi „wisieć” — nie czekamy na niego dłużej niż 300 ms
        return Promise.race([
          resumed.then(() => ctx.state === "running"),
          new Promise(r => setTimeout(() => r(ctx.state === "running"), 300))
        ]);
      },
      setMuted(m) {
        muted = m;
        if (master && ctx) master.gain.setTargetAtTime(m ? 0 : VOL, ctx.currentTime, 0.05);
      },
      stop() {
        try {
          if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
          setTimeout(() => { try { ctx && ctx.close(); } catch (e) {} }, 400);
        } catch (e) {}
      }
    };
  }

  const Intro = {
    MAX_MS: 14000,
    FALLBACK_MS: 6500,
    active: false,

    musicOn() { try { return localStorage.getItem(PREF_MUSIC) !== "0"; } catch (e) { return true; } },
    setMusic(on) { try { localStorage.setItem(PREF_MUSIC, on ? "1" : "0"); } catch (e) {} },
    enabled() { try { return localStorage.getItem(PREF_INTRO) !== "0"; } catch (e) { return true; } },
    setEnabled(on) { try { localStorage.setItem(PREF_INTRO, on ? "1" : "0"); } catch (e) {} },

    play(opts = {}) {
      if (this.active) return Promise.resolve("busy");
      if (!opts.force && !this.enabled()) return Promise.resolve("off");
      if (!opts.force && typeof root.matchMedia === "function" && root.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return Promise.resolve("reduced");
      }
      this.active = true;
      const st = DBG.intro = { phase: "playing", source: "video", music: this.musicOn(), audible: false, blocked: false, result: null, startedAt: Date.now() };

      return new Promise(resolve => {
        const el = document.createElement("div");
        el.className = "splash";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", "Ekran powitalny ResInvest ERP");
        el.innerHTML = `
          <video playsinline preload="auto" aria-hidden="true" tabindex="-1"></video>
          <div class="splash-brand" aria-hidden="true">
            <div class="mark">RI</div>
            <h2>ResInvest Commodities</h2>
            <p>ERP · obrót i magazynowanie biomasy drzewnej</p>
          </div>
          <div class="splash-ctl">
            <button type="button" class="splash-btn" data-music></button>
            <button type="button" class="splash-btn" data-skip>Pomiń intro <span aria-hidden="true">→</span></button>
          </div>
          <p class="splash-note hidden" data-note role="status"></p>
          <div class="splash-bar" aria-hidden="true"><i data-bar></i></div>`;
        document.body.appendChild(el);

        const video = el.querySelector("video");
        const bar = el.querySelector("[data-bar]");
        const note = el.querySelector("[data-note]");
        const musicBtn = el.querySelector("[data-music]");
        const skipBtn = el.querySelector("[data-skip]");
        let done = false, objectUrl = null, synth = null, armed = false, fallbackTimer = null, barTimer = null;

        const showNote = txt => { note.textContent = txt || ""; note.classList.toggle("hidden", !txt); };
        const renderBtn = () => {
          const on = this.musicOn();
          musicBtn.innerHTML = (on ? ICON_OFF : ICON_ON) + `<span>${on ? "Wycisz" : "Włącz muzykę"}</span>`;
          musicBtn.setAttribute("aria-pressed", String(!on));
          musicBtn.setAttribute("aria-label", on ? "Wycisz muzykę" : "Włącz muzykę");
        };
        const BLOCKED_TXT = "Przeglądarka zablokowała automatyczny dźwięk. Kliknij w dowolnym miejscu lub naciśnij klawisz, aby włączyć muzykę.";

        const onGesture = e => {
          if (e.type === "keydown" && (e.key === "Escape" || e.key === "Enter")) return;
          disarm();
          if (this.musicOn()) tryAudible();
        };
        const arm = () => {
          if (armed) return; armed = true;
          document.addEventListener("pointerdown", onGesture, true);
          document.addEventListener("keydown", onGesture, true);
        };
        const disarm = () => {
          if (!armed) return; armed = false;
          document.removeEventListener("pointerdown", onGesture, true);
          document.removeEventListener("keydown", onGesture, true);
        };

        /** Próba odtworzenia Z DŹWIĘKIEM; przy blokadzie — wyciszone + czekamy na gest. */
        const tryAudible = () => {
          if (done) return Promise.resolve(false);
          if (!this.musicOn()) { applyMute(); return Promise.resolve(false); }
          if (st.source === "video") {
            video.muted = false;
            let p;
            try { p = video.play(); } catch (e) { p = Promise.reject(e); }
            return Promise.resolve(p).then(() => {
              st.audible = !video.muted; st.blocked = false; showNote("");
              return true;
            }).catch(e => {
              if (done) return false;
              if (e && e.name === "NotAllowedError") {
                st.blocked = true; st.audible = false;
                video.muted = true;
                const p2 = video.play();
                if (p2 && p2.catch) p2.catch(() => {});
                arm(); showNote(BLOCKED_TXT);
              } else if (e && e.name !== "AbortError") {
                toBrand();
              }
              return false;
            });
          }
          synth = synth || createSynth();
          synth.setMuted(false);
          return synth.start().then(ok => {
            if (done) return false;
            st.audible = ok; st.blocked = !ok;
            if (ok) showNote(""); else { arm(); showNote(BLOCKED_TXT); }
            return ok;
          });
        };
        const applyMute = () => {
          st.audible = false;
          if (st.source === "video") video.muted = true;
          if (synth) synth.setMuted(true);
        };

        /** Plansza firmowa, gdy film nie może zostać odtworzony. */
        const toBrand = () => {
          if (done || st.source === "synth") return;
          st.source = "synth";
          el.classList.add("no-video");
          try { video.pause(); } catch (e) {}
          const t0 = Date.now();
          barTimer = setInterval(() => { bar.style.width = Math.min(100, (Date.now() - t0) / this.FALLBACK_MS * 100).toFixed(1) + "%"; }, 200);
          fallbackTimer = setTimeout(() => finish("end"), this.FALLBACK_MS);
          if (this.musicOn()) tryAudible();
        };

        const finish = how => {
          if (done) return; done = true;
          clearTimeout(maxTimer); clearTimeout(fallbackTimer); clearInterval(barTimer);
          disarm();
          document.removeEventListener("keydown", onKey, true);
          if (synth) synth.stop();
          try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
          if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) {} objectUrl = null; }
          el.classList.add("out");
          st.phase = "done"; st.result = how;
          setTimeout(() => { el.remove(); this.active = false; resolve(how); }, 260);
        };
        const onKey = e => {
          if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish("skip"); }
        };

        document.addEventListener("keydown", onKey, true);
        skipBtn.addEventListener("click", e => { e.stopPropagation(); finish("skip"); });
        musicBtn.addEventListener("click", e => {
          e.stopPropagation();
          const on = !this.musicOn();
          this.setMusic(on); st.music = on; renderBtn();
          if (on) tryAudible(); else { applyMute(); showNote(""); disarm(); }
        });
        const maxTimer = setTimeout(() => finish("timeout"), this.MAX_MS);
        renderBtn();
        skipBtn.focus({ preventScroll: true });

        video.addEventListener("timeupdate", () => {
          if (video.duration) bar.style.width = (video.currentTime / video.duration * 100).toFixed(1) + "%";
        });
        video.addEventListener("ended", () => { bar.style.width = "100%"; finish("end"); });
        video.addEventListener("error", () => toBrand());

        // Źródło: film osadzony jako data URI → Blob (przeglądarki niechętnie
        // odtwarzają wielomegabajtowe data: w <video>, Blob działa wszędzie).
        const src = typeof root.INTRO_SRC === "string" ? root.INTRO_SRC : "";
        const canMp4 = typeof video.canPlayType === "function" && video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== "";
        if (!src || !canMp4) { toBrand(); return; }
        try {
          const comma = src.indexOf(",");
          const bin = atob(src.slice(comma + 1));
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          objectUrl = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
          video.src = objectUrl;
        } catch (e) { toBrand(); return; }
        // start natychmiast — play() sam poczeka na dane
        if (this.musicOn()) tryAudible();
        else { video.muted = true; const p = video.play(); if (p && p.catch) p.catch(err => { if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") toBrand(); }); }
      });
    }
  };

  root.Intro = Intro;
})(typeof globalThis !== "undefined" ? globalThis : this);
