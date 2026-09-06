/* ============ 轻量 WebAudio 音效合成(无需外部素材) ============ */
(function () {
  var AC = null, master = null, muted = false;
  function ensure() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain();
        master.gain.value = 0.32;
        master.connect(AC.destination);
      } catch (e) { AC = null; }
    }
    if (AC && AC.state === "suspended") AC.resume();
  }
  function tone(f, dur, type, vol, slide) {
    if (!AC) return;
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type || "sine";
    var t0 = AC.currentTime;
    o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq) {
    if (!AC) return;
    var n = Math.floor(AC.sampleRate * dur);
    var buf = AC.createBuffer(1, n, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var s = AC.createBufferSource(); s.buffer = buf;
    var g = AC.createGain(); g.gain.value = vol;
    var f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq || 800;
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
  }
  window.SFX = {
    click: function () { tone(640, 0.06, "square", 0.1); },
    coin: function () { tone(880, 0.07, "sine", 0.25); setTimeout(function () { tone(1320, 0.12, "sine", 0.25); }, 70); },
    arrest: function () { tone(300, 0.18, "square", 0.26, 120); setTimeout(function () { tone(170, 0.24, "square", 0.26, 75); }, 90); },
    whoosh: function () { noise(0.16, 0.5, 1500); },
    bark: function () { tone(230, 0.07, "square", 0.3); setTimeout(function () { tone(255, 0.07, "square", 0.3); }, 95); },
    thunk: function () { tone(95, 0.13, "sine", 0.4); },
    poof: function () { noise(0.28, 0.35, 650); },
    zap: function () { tone(1250, 0.16, "sawtooth", 0.18, 180); },
    sprint: function () { tone(280, 0.3, "sine", 0.2, 900); },
    deny: function () { tone(150, 0.12, "square", 0.18, 110); },
    go: function () { tone(660, 0.14, "sine", 0.3); setTimeout(function () { tone(880, 0.2, "sine", 0.3); }, 120); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, 0.3, "triangle", 0.3); }, i * 140); }); },
    bite: function () { noise(0.08, 0.4, 2200); },
    join: function () { tone(440, 0.1, "sine", 0.2); },
    respawn: function () { tone(420, 0.1, "sine", 0.2, 620); }
  };
  window.Sound = {
    unlock: ensure,
    toggle: function () { muted = !muted; return muted; },
    get muted() { return muted; }
  };
})();
