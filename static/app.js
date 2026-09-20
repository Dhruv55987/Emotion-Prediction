(() => {
  'use strict';

  /* ---------- data ---------- */
  const EMOTIONS = ['sadness', 'joy', 'love', 'anger', 'fear', 'surprise'];
  const META = {
    sadness:  { label: 'Sadness',  emoji: '🙁', color: '#4C79C2' },
    joy:      { label: 'Joy',      emoji: '😁', color: '#F2B01E' },
    love:     { label: 'Love',     emoji: '🥰', color: '#E5648F' },
    anger:    { label: 'Anger',    emoji: '😡', color: '#DB3B2A' },
    fear:     { label: 'Fear',     emoji: '😨', color: '#7B54B8' },
    surprise: { label: 'Surprise', emoji: '🤪', color: '#1FB5A0' }
  };
  const SAMPLES = [
    'I finally got the job offer!',
    'I miss how things used to be',
    'You lied to me, again',
    'I can\'t stop thinking about her',
    'I heard footsteps behind me in the empty hallway',
    'Wait, you planned a surprise party for me?'
  ];
  const MAX_RECENT = 4;

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgba = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;
  const TAU = Math.PI * 2;
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const fmtPct = p => (p < 0.005 ? '<1%' : Math.round(p * 100) + '%');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOTION = reduce ? 0.3 : 1;

  const INK = hex2rgb('#1C1B2F');
  const BASE = hex2rgb('#F1F0F6');

  const els = {
    app: $('app'), form: $('form'), text: $('text'), go: $('go'), count: $('count'), error: $('error'),
    chips: $('chips'), recent: $('recent'), recentWrap: $('recentWrap'),
    status: $('status'), statusText: $('statusText'),
    verdict: $('verdict'), meta: $('meta'), sr: $('srResult'), bars: $('bars'),
    wrap: $('orbWrap'), canvas: $('orb'), face: $('face'), glyph: $('glyph')
  };

  /* ---------- the orb: one shape per emotion, blended by probability ---------- */
  const STATES = {
    idle: {
      c: hex2rgb('#8C89A8'), ts: 0.7,
      scale: () => 1, off: () => [0, 0],
      f: (a, t) => 0.05 * Math.sin(2 * a + t) + 0.03 * Math.sin(3 * a - t * 0.8)
    },
    sadness: {
      c: hex2rgb(META.sadness.color), ts: 0.45,
      scale: () => 0.9, off: () => [0, 0.07],
      f: (a, t) => 0.03 * Math.sin(2 * a + t)
        + 0.24 * Math.pow(Math.max(0, Math.sin(a)), 4) * (1 + 0.15 * Math.sin(t * 1.4))
        - 0.06 * Math.pow(Math.max(0, -Math.sin(a)), 2)
    },
    joy: {
      c: hex2rgb(META.joy.color), ts: 1.6,
      scale: () => 1.03, off: t => [0, -0.13 * Math.abs(Math.sin(t * 2.1))],
      f: (a, t) => 0.07 * Math.sin(5 * a + t * 1.5) + 0.04 * Math.sin(3 * a - t)
    },
    love: {
      c: hex2rgb(META.love.color), ts: 1,
      scale: t => 1 + 0.06 * Math.pow(Math.max(0, Math.sin(t * 2.8)), 5) + 0.035 * Math.pow(Math.max(0, Math.sin(t * 2.8 - 0.9)), 5),
      off: () => [0, -0.01],
      f: (a, t) => 0.035 * Math.sin(2 * a + t * 0.8)
        - 0.09 * Math.exp(-Math.pow(angDiff(a, -Math.PI / 2), 2) * 14)
        + 0.05 * Math.exp(-Math.pow(angDiff(a, Math.PI / 2), 2) * 6)
    },
    anger: {
      c: hex2rgb(META.anger.color), ts: 2.2,
      scale: () => 1.04, off: t => [0.012 * Math.sin(t * 22), 0.006 * Math.sin(t * 27)],
      f: (a, t) => 0.2 * Math.pow(Math.abs(Math.sin(5 * a + t * 0.6)), 7) + 0.03 * Math.sin(11 * a + t * 3)
    },
    fear: {
      c: hex2rgb(META.fear.color), ts: 2.4,
      scale: () => 0.84, off: t => [0.014 * Math.sin(t * 19) + 0.008 * Math.sin(t * 31), 0.05 + 0.008 * Math.sin(t * 23)],
      f: (a, t) => 0.05 * Math.sin(7 * a + t * 2.2) + 0.035 * Math.sin(11 * a - t * 3.1)
    },
    surprise: {
      c: hex2rgb(META.surprise.color), ts: 1.4,
      scale: t => 1 + 0.13 * Math.pow(Math.max(0, Math.sin(t * 1.9)), 3), off: () => [0, -0.02],
      f: (a, t) => 0.05 * Math.sin(6 * a + t * 2) + 0.03 * Math.sin(4 * a - t * 1.3)
    }
  };
  const KEYS = Object.keys(STATES);
  const weights = Object.fromEntries(KEYS.map(k => [k, k === 'idle' ? 1 : 0]));
  const target = { ...weights };

  const ctx = els.canvas.getContext('2d');
  let size = 300, R = 80, dpr = 1;
  function resize() {
    const r = els.wrap.getBoundingClientRect();
    size = r.width || 300;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.canvas.width = Math.round(size * dpr);
    els.canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = size * 0.27;
    els.face.style.fontSize = (R * 0.78) + 'px';
  }
  new ResizeObserver(resize).observe(els.wrap);
  resize();

  let T = 0, energy = 0, bump = 0, poke = 0, busy = false, last = performance.now();
  const par = [0, 0], parTarget = [0, 0];
  let lastThemeKey = '';
  const N = 140;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    energy += ((busy ? 1.4 : 0) - energy) * (1 - Math.exp(-dt * (busy ? 3 : 1.5)));
    bump *= Math.exp(-dt * 2.2);
    poke *= Math.exp(-dt * 2.5);
    const e = energy + bump;
    T += dt * (1 + e * 1.2) * (reduce ? 0.4 : 1);

    const k = 1 - Math.exp(-dt * 3.5);
    let sum = 0;
    for (const key of KEYS) { weights[key] += (target[key] - weights[key]) * k; sum += weights[key]; }
    sum = sum || 1;

    const kp = 1 - Math.exp(-dt * 3);
    par[0] += (parTarget[0] - par[0]) * kp;
    par[1] += (parTarget[1] - par[1]) * kp;

    const active = [];
    let sc = 0, ox = 0, oy = 0, col = [0, 0, 0];
    for (const key of KEYS) {
      const wk = weights[key] / sum;
      if (wk < 0.003) continue;
      const s = STATES[key], t = T * s.ts, o = s.off(t);
      sc += wk * s.scale(t);
      ox += wk * o[0] * MOTION;
      oy += wk * o[1] * MOTION;
      col = col.map((v, i) => v + wk * s.c[i]);
      active.push([wk, s, t]);
    }
    const amp = MOTION * (1 + e * 0.55);
    const cx = size / 2 + par[0], cy = size / 2 + par[1];

    const build = (tOff, mul, rot) => {
      const pts = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        let d = 0;
        for (const [wk, s, t] of active) d += wk * s.f(a + rot, t + tOff);
        d *= amp;
        d += poke * (0.11 * Math.sin(6 * a + T * 13) + 0.06 * Math.sin(4 * a - T * 9));
        const r = R * sc * mul * (1 + d);
        pts.push([cx + ox * R + Math.cos(a) * r, cy + oy * R + Math.sin(a) * r]);
      }
      return pts;
    };
    const path = pts => {
      ctx.beginPath();
      const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const s = m(pts[N - 1], pts[0]);
      ctx.moveTo(s[0], s[1]);
      for (let i = 0; i < N; i++) {
        const p = pts[i], q = m(p, pts[(i + 1) % N]);
        ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
      }
      ctx.closePath();
    };

    ctx.clearRect(0, 0, size, size);

    // ground shadow (shrinks when the orb bounces up)
    const lift = Math.max(-0.2, Math.min(0.3, -oy));
    ctx.fillStyle = rgba(INK, 0.10);
    ctx.beginPath();
    ctx.ellipse(cx, size / 2 + R * 1.3, R * 0.8 * (1 - lift * 0.9), R * 0.09 * (1 - lift * 0.8), 0, 0, TAU);
    ctx.fill();

    // orbiting specks
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + T * (0.15 + (i % 3) * 0.05) * (1 + e);
      const r = R * (1.42 + 0.08 * Math.sin(T + i * 1.7));
      ctx.fillStyle = rgba(col, 0.22 + 0.3 * Math.min(1, e));
      ctx.beginPath();
      ctx.arc(cx + ox * R + Math.cos(a) * r, cy + oy * R + Math.sin(a) * r * 0.92, 1.6 + (i % 3), 0, TAU);
      ctx.fill();
    }

    // surprise ring
    const ws = weights.surprise / sum;
    if (ws > 0.05) {
      const ph = (T * 0.9) % 1;
      ctx.strokeStyle = rgba(col, (1 - ph) * ws * 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + ox * R, cy + oy * R, R * (1.15 + ph * 0.55), 0, TAU);
      ctx.stroke();
    }

    // back layer
    path(build(1.9, 1.13, 0.6));
    ctx.fillStyle = rgba(col, 0.16);
    ctx.fill();

    // main body
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R * 1.25);
    g.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.55)));
    g.addColorStop(0.55, rgba(col));
    g.addColorStop(1, rgba(mix(col, INK, 0.28)));
    ctx.save();
    ctx.shadowColor = rgba(col, 0.45);
    ctx.shadowBlur = R * 0.35;
    ctx.shadowOffsetY = R * 0.12;
    path(build(0, 1, 0));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // soft highlight
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.beginPath();
    ctx.ellipse(cx + ox * R - R * 0.38, cy + oy * R - R * 0.45, R * 0.22, R * 0.12, -0.6, 0, TAU);
    ctx.fill();

    // face follows the body
    els.face.style.transform =
      `translate(-50%,-50%) translate(${(ox * R + par[0]).toFixed(1)}px,${(oy * R + par[1]).toFixed(1)}px) scale(${sc.toFixed(3)})`;

    // page colours follow the blend
    const deep = mix(col, INK, 0.5), bg = mix(BASE, col, 0.13);
    const key = [col, deep, bg].map(c => c.map(Math.round).join(',')).join('|');
    if (key !== lastThemeKey) {
      lastThemeKey = key;
      const st = els.app.style;
      st.setProperty('--accent-rgb', col.map(Math.round).join(','));
      st.setProperty('--accent-deep', rgba(deep));
      st.setProperty('--bg', rgba(bg));
      document.documentElement.style.background = rgba(bg);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // pointer parallax + poke
  if (!reduce) {
    window.addEventListener('pointermove', ev => {
      if (ev.pointerType === 'touch') return;
      const r = els.wrap.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) / window.innerWidth;
      const dy = (ev.clientY - (r.top + r.height / 2)) / window.innerHeight;
      parTarget[0] = Math.max(-1, Math.min(1, dx * 2)) * R * 0.14;
      parTarget[1] = Math.max(-1, Math.min(1, dy * 2)) * R * 0.1;
    }, { passive: true });
  }
  els.wrap.addEventListener('pointerdown', () => { poke = 1; });

  /* ---------- bars ---------- */
  els.bars.innerHTML = EMOTIONS.map(e => `
    <li class="bar" data-e="${e}" style="--c:${META[e].color}">
      <span class="name"><span aria-hidden="true">${META[e].emoji}</span>${META[e].label}</span>
      <span class="track" aria-hidden="true"><span class="fill"></span></span>
      <span class="pct">0%</span>
    </li>`).join('');
  const barEls = Object.fromEntries(EMOTIONS.map(e => {
    const li = els.bars.querySelector(`[data-e="${e}"]`);
    return [e, { li, fill: li.querySelector('.fill'), pct: li.querySelector('.pct') }];
  }));

  function countUp(el, to, done, dur = 800) {
    if (reduce) { el.textContent = done; return; }
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased) + '%';
      if (p < 1) requestAnimationFrame(step); else el.textContent = done;
    };
    requestAnimationFrame(step);
  }

  /* ---------- rendering a result ---------- */
  function setFace(emoji) {
    els.glyph.textContent = emoji;
    els.face.classList.remove('pop');
    void els.face.offsetWidth;
    els.face.classList.add('pop');
  }

  function render(data) {
    const probs = data.all_probabilities || {};
    const top = data.predicted_emotion;
    const m = META[top];
    if (!m) throw new Error('Unexpected response');

    // orb: sharpen a little so the leading emotion reads clearly
    let sum = 0;
    const raw = {};
    for (const e of EMOTIONS) { raw[e] = Math.pow(probs[e] || 0, 1.6); sum += raw[e]; }
    for (const e of EMOTIONS) target[e] = raw[e] / (sum || 1);
    target.idle = 0;
    poke = Math.max(poke, 0.6);
    setFace(m.emoji);

    // headline, letter by letter
    els.verdict.classList.remove('idle');
    els.verdict.textContent = '';
    [...m.label].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch';
      s.style.setProperty('--i', i);
      s.textContent = ch;
      els.verdict.appendChild(s);
    });

    const ranked = EMOTIONS.filter(e => e !== top).sort((a, b) => (probs[b] || 0) - (probs[a] || 0));
    const runner = ranked[0];
    const conf = data.confidence ?? probs[top] ?? 0;
    els.meta.innerHTML = `<strong id="confPct">0%</strong> confident. Runner-up: ${META[runner].label.toLowerCase()} at ${fmtPct(probs[runner] || 0)}.`;
    countUp($('confPct'), Math.round(conf * 100), Math.round(conf * 100) + '%');
    els.sr.textContent = `Predicted emotion: ${m.label}, ${Math.round(conf * 100)} percent confident.`;

    EMOTIONS.forEach((e, i) => {
      const p = probs[e] || 0, b = barEls[e];
      b.li.classList.toggle('top', e === top);
      b.fill.style.transitionDelay = (i * 60) + 'ms';
      b.fill.style.transform = `scaleX(${p > 0 ? Math.max(p, 0.012) : 0})`;
      countUp(b.pct, Math.round(p * 100), fmtPct(p));
    });

    if (window.matchMedia('(max-width: 860px)').matches) {
      els.wrap.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  /* ---------- talking to the API ---------- */
  function setBusy(v) {
    busy = v;
    els.go.classList.toggle('busy', v);
    els.go.textContent = v ? 'Reading…' : 'Read the emotion';
    els.go.setAttribute('aria-busy', String(v));
    els.go.disabled = v || !els.text.value.trim();
  }
  const showError = msg => { els.error.textContent = msg; els.error.hidden = false; poke = 1; };
  const hideError = () => { els.error.hidden = true; };

  async function analyze(raw) {
    const text = (raw || '').trim();
    if (!text || busy) return;
    hideError();
    setBusy(true);
    try {
      const [res] = await Promise.all([
        fetch('/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        }),
        sleep(650) // let the orb "think" for a moment
      ]);
      if (!res.ok) { const err = new Error('http'); err.status = res.status; throw err; }
      const data = await res.json();
      render(data);
      addRecent(text, data.predicted_emotion);
    } catch (err) {
      if (err.status === 422) showError('The text needs to be between 1 and 2000 characters.');
      else if (err.status === 503) showError('The model is still loading. Wait a few seconds and try again.');
      else if (err.status) showError('The server ran into a problem. Try again in a moment.');
      else showError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  /* ---------- server status (Render free instances sleep) ---------- */
  function setStatus(cls, msg) {
    els.status.className = 'status ' + cls;
    els.statusText.textContent = msg;
  }
  async function checkHealth() {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.model_loaded) { setStatus('ready', 'Model ready'); return; }
        }
      } catch (_) { /* keep trying */ }
      if (i === 0) setStatus('waking', 'Waking the server. This can take about a minute.');
      await sleep(3000);
    }
    setStatus('down', 'Server not responding');
  }

  /* ---------- input, examples, recent ---------- */
  function updateCount() {
    const n = els.text.value.length;
    els.count.textContent = `${n} / 2000`;
    els.count.classList.toggle('warn', n > 1800);
    els.go.disabled = busy || !els.text.value.trim();
  }
  els.text.addEventListener('input', () => { bump = Math.min(1, bump + 0.35); hideError(); updateCount(); });
  els.text.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); analyze(els.text.value); }
  });
  els.form.addEventListener('submit', ev => { ev.preventDefault(); analyze(els.text.value); });

  function useText(t) {
    if (busy) return;
    els.text.value = t;
    updateCount();
    analyze(t);
  }

  els.chips.innerHTML = '';
  SAMPLES.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s;
    b.addEventListener('click', () => useText(s));
    els.chips.appendChild(b);
  });

  const history = [];
  function addRecent(text, emotion) {
    const i = history.findIndex(h => h.text === text);
    if (i > -1) history.splice(i, 1);
    history.unshift({ text, emotion });
    if (history.length > MAX_RECENT) history.pop();
    els.recent.innerHTML = '';
    history.forEach(h => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recent-item';
      const em = document.createElement('span');
      em.setAttribute('aria-hidden', 'true');
      em.textContent = META[h.emotion]?.emoji || '';
      const tx = document.createElement('span');
      tx.textContent = h.text.length > 46 ? h.text.slice(0, 45) + '…' : h.text;
      b.append(em, tx);
      b.addEventListener('click', () => useText(h.text));
      li.appendChild(b);
      els.recent.appendChild(li);
    });
    els.recentWrap.hidden = false;
  }

  updateCount();
  checkHealth();
})();
