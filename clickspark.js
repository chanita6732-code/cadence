/* =========================================================
   ClickSpark — a small burst of sparks wherever you click (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <ClickSpark /> React component by React Bits
   (https://reactbits.dev). Same options, without React:

     const spark = createClickSpark({
       sparkColor: '#fff',      // or a function returning a colour (read at click time)
       sparkSize: 10,           // starting length of each line
       sparkRadius: 15,         // how far the lines travel
       sparkCount: 8,
       duration: 400,           // ms
       easing: 'ease-out',      // 'linear' | 'ease-in' | 'ease-in-out' | 'ease-out'
       extraScale: 1,
     });
     spark.destroy();

   Differences from the original: one full-screen canvas covers the whole
   page (instead of wrapping content), it is sharp on high-density screens,
   it only animates while sparks are alive, it is skipped for people who
   prefer reduced motion, and it also shows above open dialogs.
   ========================================================= */
'use strict';

function createClickSpark(options = {}) {
  const opts = {
    sparkColor: '#fff', sparkSize: 10, sparkRadius: 15, sparkCount: 8,
    duration: 400, easing: 'ease-out', extraScale: 1,
    ...options,
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // Inline so it can never affect layout, whatever stylesheet is loaded
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;pointer-events:none;user-select:none;z-index:2147483000;overflow:visible';
  // A popover lives in the browser's top layer, which lets sparks show above modal dialogs too
  const usePopover = typeof canvas.showPopover === 'function';
  if (usePopover) canvas.setAttribute('popover', 'manual');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let sparks = [];
  let frame = null;
  let width = 0;
  let height = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ease(t) {
    switch (opts.easing) {
      case 'linear': return t;
      case 'ease-in': return t * t;
      case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      default: return t * (2 - t);
    }
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    sparks = sparks.filter((s) => {
      const elapsed = now - s.start;
      if (elapsed >= opts.duration) return false;
      const eased = ease(Math.max(0, elapsed) / opts.duration);
      const distance = eased * opts.sparkRadius * opts.extraScale;
      const length = opts.sparkSize * (1 - eased);
      const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x + distance * cos, s.y + distance * sin);
      ctx.lineTo(s.x + (distance + length) * cos, s.y + (distance + length) * sin);
      ctx.stroke();
      return true;
    });
    if (sparks.length) { frame = requestAnimationFrame(draw); return; }
    // Nothing left to draw: stop the loop and step out of the top layer
    frame = null;
    if (usePopover) { try { canvas.hidePopover(); } catch { /* already hidden */ } }
  }

  /** Bring the canvas to the front of the top layer (above any dialog opened since). */
  function raise() {
    if (!usePopover) return;
    try {
      if (canvas.matches(':popover-open')) canvas.hidePopover();
      canvas.showPopover();
    } catch { /* not connected yet, or unsupported */ }
  }

  function onClick(e) {
    // Keyboard "clicks" (Enter/Space) have no pointer position
    if (reduceMotion.matches || (e.clientX === 0 && e.clientY === 0)) return;
    const color = typeof opts.sparkColor === 'function' ? opts.sparkColor() : opts.sparkColor;
    const start = performance.now();
    for (let i = 0; i < opts.sparkCount; i++) {
      sparks.push({ x: e.clientX, y: e.clientY, angle: (2 * Math.PI * i) / opts.sparkCount, start, color });
    }
    raise();
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // Capture phase: runs even when a handler stops the event or re-renders the clicked element
  document.addEventListener('click', onClick, true);
  window.addEventListener('resize', resize);
  resize();

  return {
    update(next) { Object.assign(opts, next); },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}
