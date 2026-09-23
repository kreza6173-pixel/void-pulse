// VOID//PULSE — mic-reactive light show (Web Audio API AnalyserNode)
"use strict";

const PulseVisualizer = (function () {
  let audioCtx = null;
  let analyser = null;
  let source = null;
  let stream = null;
  let rafId = null;
  let canvas = null;
  let ctx2d = null;
  let sensitivity = 5;
  let theme = "cyber";
  let running = false;

  const THEMES = {
    cyber:  { a: "#29F1E0", b: "#FF2E92", bg: "rgba(7,6,11,0.28)" },
    magma:  { a: "#FF6A2E", b: "#FFD24D", bg: "rgba(10,4,2,0.28)" },
    void:   { a: "#7B5CFF", b: "#29F1E0", bg: "rgba(6,4,14,0.28)" }
  };

  function resize() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    if (!analyser || !ctx2d) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const t = THEMES[theme] || THEMES.cyber;
    ctx2d.fillStyle = t.bg;
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    const bars = 48;
    const step = Math.floor(data.length / bars);
    const barW = canvas.width / bars;
    const boost = sensitivity / 5;

    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j];
      const avg = (sum / step) * boost;
      const h = Math.min(canvas.height, (avg / 255) * canvas.height);
      const grad = ctx2d.createLinearGradient(0, canvas.height - h, 0, canvas.height);
      grad.addColorStop(0, t.a);
      grad.addColorStop(1, t.b);
      ctx2d.fillStyle = grad;
      const x = i * barW;
      ctx2d.fillRect(x + 1, canvas.height - h, barW - 2, h);
    }

    // pulse ring for overall loudness
    let total = 0;
    for (let i = 0; i < data.length; i++) total += data[i];
    const level = (total / data.length / 255) * boost;
    const r = Math.min(canvas.width, canvas.height) * 0.12 * (0.6 + level * 1.4);
    ctx2d.beginPath();
    ctx2d.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2);
    ctx2d.strokeStyle = t.a;
    ctx2d.globalAlpha = 0.5;
    ctx2d.lineWidth = 3;
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
  }

  return {
    setTheme: function (name) { theme = name; },
    setSensitivity: function (v) { sensitivity = v; },
    isRunning: function () { return running; },
    start: async function (canvasEl) {
      canvas = canvasEl;
      ctx2d = canvas.getContext("2d");
      resize();
      window.addEventListener("resize", resize);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      running = true;
      draw();
    },
    stop: function () {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      if (audioCtx) audioCtx.close();
      stream = null; audioCtx = null; analyser = null; source = null;
      if (ctx2d && canvas) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
})();
