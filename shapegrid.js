/* =========================================================
   ShapeGrid — animated grid background (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <ShapeGrid /> React component by React Bits
   (https://reactbits.dev). Same options and look, without React:

     const grid = createShapeGrid(host, {
       shape: 'hexagon',        // 'square' | 'hexagon' | 'circle' | 'triangle'
       squareSize: 23,          // tile size in px
       direction: 'diagonal',   // 'up' | 'down' | 'left' | 'right' | 'diagonal'
       speed: 0.5,
       borderColor: '#999',
       hoverFillColor: '#222',
       hoverTrailAmount: 5,     // fading trail behind the pointer (0 = none)
       eventTarget: element,    // where to listen for the pointer (default: the host)
     });
     grid.update({ borderColor, hoverFillColor });   // e.g. after a theme change
     grid.destroy();

   `host` is a positioned element with overflow hidden; the grid fills it.

   Differences from the original: the outlines are drawn ONCE onto a canvas
   slightly larger than the host, and each frame only slides that finished
   picture with a transform. The original re-draws every line 60 times a
   second, which makes the whole page stutter on slower devices.
   Also: sharp on high-density screens, no drift for people who prefer
   reduced motion, and the pointer can be tracked on a parent element so
   content on top doesn't block it.
   ========================================================= */
'use strict';

function createShapeGrid(host, options = {}) {
  const opts = {
    direction: 'right', speed: 1, borderColor: '#999', squareSize: 40,
    hoverFillColor: '#222', shape: 'square', hoverTrailAmount: 0, eventTarget: host,
    ...options,
  };
  const MAX_PIXELS = 5e6; // per canvas; keeps memory in check on very large screens
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;border:0;pointer-events:none;will-change:transform';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const outlines = document.createElement('canvas'); // the grid without highlights
  const cellOpacities = new Map();
  let hovered = null;
  let trail = [];
  let pointer = null;   // last pointer position (viewport px) while it is over the event target
  let frame = null;
  let travel = { x: 0, y: 0 };
  let path = null;      // { from, to, duration } of the drift
  let hostBox = { left: 0, top: 0 };
  let last = null;      // canvas position on the previous frame, to notice the drift looping
  let width = 0;
  let height = 0;
  let dpr = 1;

  const size = () => opts.squareSize;
  const isHex = () => opts.shape === 'hexagon';
  const isTri = () => opts.shape === 'triangle';
  const hexHoriz = () => size() * 1.5;
  const hexVert = () => size() * Math.sqrt(3);
  const mod = (n, m) => ((n % m) + m) % m;
  // The pattern repeats every wrapX × wrapY px; cells sit stepX × stepY apart
  const wrapX = () => (isHex() ? hexHoriz() * 2 : size());
  const wrapY = () => (isHex() ? hexVert() : isTri() ? size() * 2 : size());
  const stepX = () => (isHex() ? hexHoriz() : isTri() ? size() / 2 : size());
  const stepY = () => (isHex() ? hexVert() : size());

  /* ---------- shapes: each adds one closed outline to the current path of `c` ---------- */
  function pathHex(c, cx, cy, s) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }
  function pathCircle(c, cx, cy, s) {
    c.moveTo(cx + s / 2, cy);
    c.arc(cx, cy, s / 2, 0, Math.PI * 2);
    c.closePath();
  }
  function pathTriangle(c, cx, cy, s, flip) {
    if (flip) {
      c.moveTo(cx, cy + s / 2); c.lineTo(cx + s / 2, cy - s / 2); c.lineTo(cx - s / 2, cy - s / 2);
    } else {
      c.moveTo(cx, cy - s / 2); c.lineTo(cx + s / 2, cy + s / 2); c.lineTo(cx - s / 2, cy + s / 2);
    }
    c.closePath();
  }
  /** Add the outline of cell (col, row) to `c` (canvas coordinates). */
  function cellPath(c, col, row) {
    const s = size();
    if (isHex()) {
      const h = hexHoriz(), v = hexVert();
      pathHex(c, col * h, row * v + (col % 2 !== 0 ? v / 2 : 0), s);
    } else if (isTri()) {
      pathTriangle(c, col * (s / 2), row * s + s / 2, s, mod(col + row, 2) !== 0);
    } else if (opts.shape === 'circle') {
      pathCircle(c, col * s + s / 2, row * s + s / 2, s);
    } else {
      c.rect(col * s, row * s, s, s);
    }
  }
  /** Which cell is at this canvas position. */
  function cellAt(px, py) {
    const s = size();
    if (isHex()) {
      const h = hexHoriz(), v = hexVert();
      const col = Math.round(px / h);
      return { x: col, y: Math.round((py - (col % 2 !== 0 ? v / 2 : 0)) / v) };
    }
    if (isTri()) return { x: Math.round(px / (s / 2)), y: Math.floor(py / s) };
    return opts.shape === 'circle'
      ? { x: Math.round(px / s), y: Math.round(py / s) }
      : { x: Math.floor(px / s), y: Math.floor(py / s) };
  }

  /* ---------- drift ---------- */
  /** How far the canvas moves before the pattern lines up again (px on each axis). */
  function loopTravel() {
    const dir = opts.direction;
    const wx = wrapX(), wy = wrapY();
    if (dir === 'left' || dir === 'right') return { x: wx, y: 0 };
    if (dir === 'up' || dir === 'down') return { x: 0, y: wy };
    // Diagonal: both axes must finish a whole number of repeats together.
    // Take the smallest pair of counts whose distances match within 1.5%.
    let best = { n: 1, m: 1, err: Infinity };
    for (let total = 2; total <= 16; total++) {
      for (let n = 1; n < total; n++) {
        const m = total - n;
        const err = Math.abs(n * wx - m * wy) / Math.max(n * wx, m * wy);
        if (err < best.err - 1e-9) best = { n, m, err };
      }
      if (best.err < 0.015) break;
    }
    return { x: best.n * wx, y: best.m * wy };
  }

  function startDrift() {
    last = null;
    path = null;
    canvas.style.transform = 'none';
    if (reduceMotion.matches || (!travel.x && !travel.y)) return;
    const dir = opts.direction;
    // Same directions as the original: 'right' and 'diagonal' slide the pattern left, 'down' slides it up
    const sx = dir === 'left' ? 1 : -1;
    const sy = dir === 'up' ? 1 : -1;
    // The canvas is larger than the host by `travel`, so anywhere between -travel and 0 covers it
    const from = { x: sx > 0 ? -travel.x : 0, y: sy > 0 ? -travel.y : 0 };
    const to = { x: sx > 0 ? 0 : -travel.x, y: sy > 0 ? 0 : -travel.y };
    const pxPerSecond = Math.max(opts.speed, 0.1) * 60;
    path = { from, to, duration: (Math.max(travel.x, travel.y) / pxPerSecond) * 1000 };
    wake();
  }

  /** How far the canvas has slid at time `now` (ms). The pattern repeats, so only the phase matters. */
  function driftOffset(now) {
    if (!path) return { x: 0, y: 0 };
    const p = mod(now, path.duration) / path.duration;
    return { x: path.from.x + (path.to.x - path.from.x) * p, y: path.from.y + (path.to.y - path.from.y) * p };
  }

  /* ---------- drawing ---------- */
  function renderOutlines() {
    const c = outlines.getContext('2d');
    outlines.width = canvas.width;
    outlines.height = canvas.height;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.beginPath();
    const cols = Math.ceil((width + travel.x) / stepX()) + 2;
    const rows = Math.ceil((height + travel.y) / stepY()) + 2;
    for (let col = -2; col < cols; col++) {
      for (let row = -2; row < rows; row++) cellPath(c, col, row);
    }
    c.strokeStyle = opts.borderColor;
    c.stroke();
  }

  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(outlines, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cellOpacities.forEach((alpha, key) => {
      const [col, row] = key.split(',').map(Number);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      cellPath(ctx, col, row);
      ctx.fillStyle = opts.hoverFillColor;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) { width = 0; height = 0; return; } // hidden: the loop stops until it is shown again
    width = w;
    height = h;
    hostBox = host.getBoundingClientRect();
    travel = loopTravel();
    const cssW = Math.ceil(width + travel.x), cssH = Math.ceil(height + travel.y);
    dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (cssW * cssH)));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    cellOpacities.clear();
    trail = [];
    hovered = null;
    renderOutlines();
    paint();
    startDrift();
  }

  /* ---------- pointer highlight (the only part that needs JavaScript per frame) ---------- */
  function pushTrail() {
    if (!hovered || opts.hoverTrailAmount <= 0) return;
    trail.unshift({ ...hovered });
    if (trail.length > opts.hoverTrailAmount) trail.length = opts.hoverTrailAmount;
  }

  /** When the drift loops, the canvas jumps back; move the highlights with it so they stay put on screen. */
  function followLoop(rect) {
    if (last) {
      const jx = rect.left - last.left, jy = rect.top - last.top;
      const dc = Math.abs(jx) > travel.x / 2 && travel.x ? Math.round(jx / stepX()) : 0;
      const dr = Math.abs(jy) > travel.y / 2 && travel.y ? Math.round(jy / stepY()) : 0;
      if (dc || dr) {
        const moved = new Map();
        cellOpacities.forEach((alpha, key) => {
          const [col, row] = key.split(',').map(Number);
          moved.set(`${col - dc},${row - dr}`, alpha);
        });
        cellOpacities.clear();
        moved.forEach((alpha, key) => cellOpacities.set(key, alpha));
        trail.forEach((c) => { c.x -= dc; c.y -= dr; });
        if (hovered) { hovered.x -= dc; hovered.y -= dr; }
      }
    }
    last = { left: rect.left, top: rect.top };
  }

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
    let changed = false;
    cellOpacities.forEach((opacity, key) => {
      const target = targets.get(key) || 0;
      if (Math.abs(target - opacity) < 0.004) return;
      const next = opacity + (target - opacity) * 0.15;
      if (next < 0.005 && !target) cellOpacities.delete(key); else cellOpacities.set(key, next);
      changed = true;
    });
    cellOpacities.forEach((opacity, key) => { if (opacity < 0.005 && !targets.has(key)) cellOpacities.delete(key); });
    return changed;
  }

  /* One loop does everything that moves. Each frame it only shifts the finished picture
     (a transform, no re-drawing); the canvas is re-painted only when a highlight changes.
     It is driven from here rather than by a CSS/Web animation because those can freeze
     on iPad and iPhone after the page has been in the background. */
  function tick(now) {
    frame = null;
    if (!width || document.hidden) return;
    const off = driftOffset(now);
    if (path) canvas.style.transform = `translate3d(${off.x.toFixed(2)}px, ${off.y.toFixed(2)}px, 0)`;
    const rect = { left: hostBox.left + off.x, top: hostBox.top + off.y };
    followLoop(rect);
    if (pointer) {
      const cell = cellAt(pointer.x - rect.left, pointer.y - rect.top);
      if (!hovered || hovered.x !== cell.x || hovered.y !== cell.y) { pushTrail(); hovered = cell; }
    }
    if (fadeCells()) paint();
    if (path || pointer || cellOpacities.size) frame = requestAnimationFrame(tick);
    else last = null;
  }
  function wake() { if (!frame && width && !document.hidden) frame = requestAnimationFrame(tick); }
  // Coming back from the background, another tab or a locked screen: pick the loop up again
  const onResume = () => { last = null; wake(); };

  // Mouse only: a finger has no hover, and its last position would leave a highlight stuck on screen
  function onMove(e) { if (e.pointerType !== 'mouse') return; pointer = { x: e.clientX, y: e.clientY }; wake(); }
  function onLeave() { if (!pointer) return; pointer = null; pushTrail(); hovered = null; wake(); }

  /* ---------- lifecycle ---------- */
  // Fires when the host is shown, hidden or changes size
  const ro = new ResizeObserver(() => {
    if (host.clientWidth !== width || host.clientHeight !== height) resize();
  });
  const onMotionChange = () => startDrift();

  ro.observe(host);
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('focus', onResume);
  reduceMotion.addEventListener?.('change', onMotionChange);
  opts.eventTarget.addEventListener('pointermove', onMove);
  opts.eventTarget.addEventListener('pointerleave', onLeave);
  resize();

  return {
    update(next) {
      const geometry = ['shape', 'squareSize', 'direction', 'speed'].some((k) => k in next && next[k] !== opts[k]);
      Object.assign(opts, next);
      if (geometry) { resize(); return; }
      if (!width) return;
      renderOutlines();
      paint();
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
      reduceMotion.removeEventListener?.('change', onMotionChange);
      opts.eventTarget.removeEventListener('pointermove', onMove);
      opts.eventTarget.removeEventListener('pointerleave', onLeave);
      canvas.remove();
    },
  };
}
