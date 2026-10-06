/* =========================================================
   Celebrate — small rewards for finishing a habit (plain JavaScript)
   ---------------------------------------------------------
     const party = createCelebrate();
     party.burst(x, y, ['#9181ff', '#fff']);   // a ring and a few dots from one point
     party.confetti(['#a78bfa', '#38bdf8']);   // a short, light shower across the screen
     party.destroy();

   Deliberately modest: few pieces, short, nothing loops. One full-screen
   canvas that never takes clicks, animates only while pieces are alive, and
   does nothing for people who prefer reduced motion.
   ========================================================= */
'use strict';

function createCelebrate() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // Inline so it can never affect layout, whatever stylesheet is loaded
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147482000';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let pieces = [];
  let frame = null;
  let last = 0;
  let width = 0;
  let height = 0;

  /** Match the drawing surface to the screen as it is right now (phones don't always announce a change). */
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || window.innerWidth, h = rect.height || window.innerHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function draw(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.clearRect(0, 0, width, height);
    pieces = pieces.filter((p) => {
      p.age += dt;
      if (p.age < 0) return true; // not started yet
      const t = p.age / p.life;
      if (t >= 1) return false;
      if (p.kind === 'ring') {
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - t, 3)), 0, Math.PI * 2);
        ctx.stroke();
        return true;
      }
      p.vy += p.gravity * dt;
      p.vx *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = t < p.fadeFrom ? 1 : 1 - (t - p.fadeFrom) / (1 - p.fadeFrom);
      ctx.fillStyle = p.color;
      if (p.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A paper strip tumbling as it falls
        p.spin += p.spinSpeed * dt;
        ctx.save();
        ctx.translate(p.x + Math.sin(p.age * p.sway) * 6, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, Math.cos(p.age * p.flip));
        ctx.fillRect(-p.size / 2, -p.size * 0.8, p.size, p.size * 1.6);
        ctx.restore();
      }
      return true;
    });
    ctx.globalAlpha = 1;
    frame = pieces.length ? requestAnimationFrame(draw) : null;
  }

  function run() {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(draw);
  }

  return {
    /** A ring and a handful of dots flying out of (x, y) in viewport px. */
    burst(x, y, colors = ['#fff']) {
      if (reduceMotion.matches) return;
      fit();
      pieces.push({ kind: 'ring', x, y, r0: 8, r1: 30, color: colors[0], age: 0, life: 0.45 });
      const count = 10;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + rand(-0.25, 0.25);
        const speed = rand(90, 170);
        pieces.push({
          kind: 'dot', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40,
          gravity: 320, drag: 1.6, size: rand(2, 3.4), color: pick(colors), age: 0, life: rand(0.5, 0.75), fadeFrom: 0.45,
        });
      }
      run();
    },

    /** A light shower of paper from the top of the screen, over in under two seconds. */
    confetti(colors = ['#fff']) {
      if (reduceMotion.matches) return;
      fit();
      const count = Math.round(Math.max(26, Math.min(56, width / 16)));
      for (let i = 0; i < count; i++) {
        pieces.push({
          kind: 'paper', x: rand(0, width), y: rand(-30, -10), vx: rand(-30, 30), vy: rand(150, 300),
          gravity: 160, drag: 0.2, size: rand(5, 8), color: pick(colors),
          spin: rand(0, Math.PI), spinSpeed: rand(-4, 4), sway: rand(2, 5), flip: rand(4, 9),
          age: -rand(0, 0.35), life: rand(1.3, 1.9), fadeFrom: 0.7,
        });
      }
      run();
    },

    destroy() {
      if (frame) cancelAnimationFrame(frame);
      canvas.remove();
    },
  };
}
