/* =========================================================
   ShapeGrid — animated grid background (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <ShapeGrid /> React component by React Bits
   (https://reactbits.dev). Same options and behaviour, without React:

     const grid = createShapeGrid(canvas, {
       shape: 'hexagon',        // 'square' | 'hexagon' | 'circle' | 'triangle'
       squareSize: 23,          // tile size in px
       direction: 'diagonal',   // 'up' | 'down' | 'left' | 'right' | 'diagonal'
       speed: 0.5,
       borderColor: '#999',
       hoverFillColor: '#222',
       hoverTrailAmount: 5,     // fading trail behind the pointer (0 = none)
       eventTarget: element,    // where to listen for the pointer (default: the canvas)
     });
     grid.update({ borderColor, hoverFillColor });   // e.g. after a theme change
     grid.destroy();

   Differences from the original: sharp on high-density screens, the
   drift pauses for people who prefer reduced motion, and the pointer
   can be tracked on a parent element so content on top doesn't block it.
   ========================================================= */
'use strict';

function createShapeGrid(canvas, options = {}) {
  const opts = {
    direction: 'right', speed: 1, borderColor: '#999', squareSize: 40,
    hoverFillColor: '#222', shape: 'square', hoverTrailAmount: 0, eventTarget: canvas,
    ...options,
  };
  const ctx = canvas.getContext('2d');
  const gridOffset = { x: 0, y: 0 };
  const cellOpacities = new Map();
  let hovered = null;
  let trail = [];
  let frame = null;
  let width = 0;
  let height = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const size = () => opts.squareSize;
  const isHex = () => opts.shape === 'hexagon';
  const isTri = () => opts.shape === 'triangle';
  const hexHoriz = () => size() * 1.5;
  const hexVert = () => size() * Math.sqrt(3);
  const mod = (n, m) => ((n % m) + m) % m;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.offsetWidth;
    height = canvas.offsetHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------- shapes ---------- */
  function pathHex(cx, cy, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function pathCircle(cx, cy, s) {
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.closePath();
  }
  function pathTriangle(cx, cy, s, flip) {
    ctx.beginPath();
    if (flip) {
      ctx.moveTo(cx, cy + s / 2); ctx.lineTo(cx + s / 2, cy - s / 2); ctx.lineTo(cx - s / 2, cy - s / 2);
    } else {
      ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx + s / 2, cy + s / 2); ctx.lineTo(cx - s / 2, cy + s / 2);
    }
    ctx.closePath();
  }
  function pathSquare(x, y, s) {
    ctx.beginPath();
    ctx.rect(x, y, s, s);
  }

  /** Fill (if highlighted) and outline one cell whose path is built by `path`. */
  function paintCell(col, row, path) {
    const alpha = cellOpacities.get(`${col},${row}`);
    if (alpha) {
      ctx.globalAlpha = alpha;
      path();
      ctx.fillStyle = opts.hoverFillColor;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    path();
    ctx.strokeStyle = opts.borderColor;
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const s = size();
    if (isHex()) {
      const h = hexHoriz(), v = hexVert();
      const colShift = Math.floor(gridOffset.x / h);
      const ox = mod(gridOffset.x, h), oy = mod(gridOffset.y, v);
      const cols = Math.ceil(width / h) + 3, rows = Math.ceil(height / v) + 3;
      for (let col = -2; col < cols; col++) {
        for (let row = -2; row < rows; row++) {
          const cx = col * h + ox;
          const cy = row * v + ((col + colShift) % 2 !== 0 ? v / 2 : 0) + oy;
          paintCell(col, row, () => pathHex(cx, cy, s));
        }
      }
    } else if (isTri()) {
      const half = s / 2;
      const colShift = Math.floor(gridOffset.x / half), rowShift = Math.floor(gridOffset.y / s);
      const ox = mod(gridOffset.x, half), oy = mod(gridOffset.y, s);
      const cols = Math.ceil(width / half) + 4, rows = Math.ceil(height / s) + 4;
      for (let col = -2; col < cols; col++) {
        for (let row = -2; row < rows; row++) {
          const cx = col * half + ox, cy = row * s + s / 2 + oy;
          const flip = mod(col + colShift + row + rowShift, 2) !== 0;
          paintCell(col, row, () => pathTriangle(cx, cy, s, flip));
        }
      }
    } else {
      const circle = opts.shape === 'circle';
      const ox = mod(gridOffset.x, s), oy = mod(gridOffset.y, s);
      const cols = Math.ceil(width / s) + 3, rows = Math.ceil(height / s) + 3;
      for (let col = -2; col < cols; col++) {
        for (let row = -2; row < rows; row++) {
          const x = col * s + ox, y = row * s + oy;
          paintCell(col, row, circle ? () => pathCircle(x + s / 2, y + s / 2, s) : () => pathSquare(x, y, s));
        }
      }
    }
  }

  /* ---------- animation ---------- */
  function fadeCells() {
    const targets = new Map();
    if (hovered) targets.set(`${hovered.x},${hovered.y}`, 1);
    if (opts.hoverTrailAmount > 0) {
      trail.forEach((c, i) => {
        const key = `${c.x},${c.y}`;
        if (!targets.has(key)) targets.set(key, (trail.length - i) / (trail.length + 1));
      });
    }
    targets.forEach((_, key) => { if (!cellOpacities.has(key)) cellOpacities.set(key, 0); });
    cellOpacities.forEach((opacity, key) => {
      const next = opacity + ((targets.get(key) || 0) - opacity) * 0.15;
      if (next < 0.005) cellOpacities.delete(key); else cellOpacities.set(key, next);
    });
  }

  function tick() {
    if (!reduceMotion.matches) {
      const sp = Math.max(opts.speed, 0.1);
      const wrapX = isHex() ? hexHoriz() * 2 : size();
      const wrapY = isHex() ? hexVert() : isTri() ? size() * 2 : size();
      const dir = opts.direction;
      if (dir === 'right' || dir === 'diagonal') gridOffset.x = (gridOffset.x - sp + wrapX) % wrapX;
      if (dir === 'left') gridOffset.x = (gridOffset.x + sp + wrapX) % wrapX;
      if (dir === 'up') gridOffset.y = (gridOffset.y + sp + wrapY) % wrapY;
      if (dir === 'down' || dir === 'diagonal') gridOffset.y = (gridOffset.y - sp + wrapY) % wrapY;
    }
    fadeCells();
    draw();
    frame = requestAnimationFrame(tick);
  }

  /* ---------- pointer ---------- */
  function cellAt(px, py) {
    const s = size();
    if (isHex()) {
      const h = hexHoriz(), v = hexVert();
      const colShift = Math.floor(gridOffset.x / h);
      const col = Math.round((px - mod(gridOffset.x, h)) / h);
      const rowOffset = (col + colShift) % 2 !== 0 ? v / 2 : 0;
      return { x: col, y: Math.round((py - mod(gridOffset.y, v) - rowOffset) / v) };
    }
    if (isTri()) {
      const half = s / 2;
      return { x: Math.round((px - mod(gridOffset.x, half)) / half), y: Math.floor((py - mod(gridOffset.y, s)) / s) };
    }
    const ax = px - mod(gridOffset.x, s), ay = py - mod(gridOffset.y, s);
    return opts.shape === 'circle'
      ? { x: Math.round(ax / s), y: Math.round(ay / s) }
      : { x: Math.floor(ax / s), y: Math.floor(ay / s) };
  }
  function pushTrail() {
    if (!hovered || opts.hoverTrailAmount <= 0) return;
    trail.unshift({ ...hovered });
    if (trail.length > opts.hoverTrailAmount) trail.length = opts.hoverTrailAmount;
  }
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const cell = cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hovered || hovered.x !== cell.x || hovered.y !== cell.y) { pushTrail(); hovered = cell; }
  }
  function onLeave() { pushTrail(); hovered = null; }

  /* ---------- run only while visible ---------- */
  let onScreen = false;
  const start = () => { if (onScreen && !document.hidden && !frame) frame = requestAnimationFrame(tick); };
  const stop = () => { if (frame) { cancelAnimationFrame(frame); frame = null; } };
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) { resize(); start(); } else stop();
  }, { threshold: 0 });
  const onVisibility = () => (document.hidden ? stop() : start());

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  opts.eventTarget.addEventListener('mousemove', onMove);
  opts.eventTarget.addEventListener('mouseleave', onLeave);
  io.observe(canvas);
  resize();

  return {
    update(next) { Object.assign(opts, next); draw(); },
    destroy() {
      stop();
      io.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      opts.eventTarget.removeEventListener('mousemove', onMove);
      opts.eventTarget.removeEventListener('mouseleave', onLeave);
    },
  };
}
