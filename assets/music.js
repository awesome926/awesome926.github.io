/* Own music player shared by the site and the promo.
   ─────────────────────────────────────────────────────────────
   HOW TO ADD YOUR TRACK
   1. put the file here:  assets/music/track.mp3
   2. change TITLE / ARTIST / START below if you want
   3. commit + push — that's it. While the file is missing, the pages
      fall back to the Yandex Music widget.
   ───────────────────────────────────────────────────────────── */
(function () {
  const CFG = {
    src: 'assets/music/track.mp3',
    title: 'Мой трек',
    artist: 'ökǒmomorîrěmnant',
    start: 15,        // seconds: playback (and every loop) starts here
    volume: 0.3,      // default volume 0..1
    fadeIn: 2.2       // seconds
  };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const saved = parseFloat(store.get('music_vol'));
  const M = window.Music = {
    cfg: CFG,
    ok: false, playing: false,
    volume: isFinite(saved) ? Math.min(1, Math.max(0, saved)) : CFG.volume,
    beat: 0,                  // 0..1, bass energy (drives the flowers)
    bands: [0, 0, 0, 0, 0],   // 0..1, five equalizer bars
    listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach(f => { try { f(this); } catch (e) {} }); }
  };
  let el = null, ctx = null, an = null, gain = null, data = null, wantPlay = false;

  M.available = fetch(CFG.src, { method: 'HEAD', cache: 'no-store' })
    .then(r => r.ok && !/text\/html/.test(r.headers.get('content-type') || ''))
    .catch(() => false)
    .then(ok => { M.ok = ok; if (ok) prepare(); return ok; });

  function prepare() {
    el = new Audio(CFG.src);
    el.preload = 'auto';
    el.addEventListener('loadedmetadata', () => { if (el.currentTime < CFG.start && el.duration > CFG.start) el.currentTime = CFG.start; });
    el.addEventListener('ended', () => { el.currentTime = CFG.start; if (wantPlay) el.play().catch(() => {}); });
    el.addEventListener('play', () => { M.playing = true; M.emit(); });
    el.addEventListener('pause', () => { M.playing = false; M.emit(); });
  }
  function graph() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const src = ctx.createMediaElementSource(el);
    an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = .72;
    gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(an); an.connect(gain); gain.connect(ctx.destination);   // analyser before gain: visuals don't depend on volume
    data = new Uint8Array(an.frequencyBinCount);
  }
  function ramp(v, d) {
    if (!gain) { el.volume = v; return; }
    const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(v, t + d);
  }
  // must be called from a user gesture (click / tap / key) — browsers block sound otherwise
  M.play = function (fromStart) {
    if (!M.ok || !el) return Promise.resolve(false);
    graph(); wantPlay = true;
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (fromStart || el.currentTime < CFG.start) { try { el.currentTime = CFG.start; } catch (e) {} }
    const p = el.play();
    ramp(M.volume, CFG.fadeIn);
    return (p && p.then ? p : Promise.resolve()).then(() => true).catch(() => false);
  };
  M.pause = function () {
    if (!el) return; wantPlay = false;
    ramp(0, .35); setTimeout(() => { if (!wantPlay) el.pause(); }, 380);
  };
  M.toggle = function () { return M.playing ? (M.pause(), Promise.resolve(false)) : M.play(); };
  M.setVolume = function (v) {
    M.volume = Math.min(1, Math.max(0, v)); store.set('music_vol', M.volume);
    if (M.playing) ramp(M.volume, .12); M.emit();
  };
  M.restart = function () { if (el) { try { el.currentTime = CFG.start; } catch (e) {} } };

  // analysis loop: five log-spaced bands + a bass "beat" with fast attack / slow release
  const EDGES = [1, 3, 7, 16, 36, 90];
  let avgLow = 0;
  function tick() {
    requestAnimationFrame(tick);
    if (!an || !M.playing) {
      M.beat *= .92; M.bands = M.bands.map(b => b * .9);
      if (window.FIELD) window.FIELD.beat = M.beat;
      return;
    }
    an.getByteFrequencyData(data);
    for (let b = 0; b < 5; b++) {
      let s = 0; for (let i = EDGES[b]; i < EDGES[b + 1]; i++) s += data[i];
      const v = s / (EDGES[b + 1] - EDGES[b]) / 255;
      M.bands[b] += (Math.pow(v, 1.4) - M.bands[b]) * .5;
    }
    let low = 0; for (let i = 1; i < 6; i++) low += data[i]; low /= 5 * 255;
    avgLow += (low - avgLow) * .02;
    const hit = Math.max(0, (low - avgLow * 1.05) * 4);
    M.beat = hit > M.beat ? M.beat + (hit - M.beat) * .6 : M.beat * .9;
    M.beat = Math.min(1, M.beat);
    if (window.FIELD) window.FIELD.beat = M.beat;
  }
  requestAnimationFrame(tick);
})();
