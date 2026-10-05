/* =========================================================
   Dock — floating navigation that magnifies under the pointer (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <Dock /> React component by React Bits
   (https://reactbits.dev). The original uses React + the `motion` library;
   this version animates the same spring by hand and works on the markup in
   index.html (.dock-panel > .dock-item), so the items stay real links/buttons.

     const dock = createDock(document.querySelector('.dock-panel'), {
       baseItemSize: 50,      // px, resting size of an item
       magnification: 70,     // px, size right under the pointer
       distance: 200,         // px, how far the pointer's influence reaches
       spring: { mass: 0.1, stiffness: 150, damping: 12 },
     });
     dock.destroy();

   Differences from the original: item size adapts to narrow screens so all
   items fit, magnification is off on touch devices and for people who prefer
   reduced motion, and the animation loop only runs while something is moving.
   ========================================================= */
'use strict';

function createDock(panel, options = {}) {
  const opts = {
    baseItemSize: 50, magnification: 70, distance: 200,
    spring: { mass: 0.1, stiffness: 150, damping: 12 },
    ...options,
  };
  const canHover = window.matchMedia('(hover: hover)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const items = Array.from(panel.querySelectorAll('.dock-item')).map((el) => ({ el, size: 0, velocity: 0, target: 0 }));
  let base = opts.baseItemSize;
  let peak = opts.magnification;
  let mouseX = Infinity;
  let frame = null;
  let last = 0;

  /** Fit every item on the screen: shrink the resting size on narrow viewports. */
  function measure() {
    const style = getComputedStyle(panel);
    const gap = parseFloat(style.columnGap) || 0;
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const room = window.innerWidth - 24 - padding - gap * (items.length - 1);
    base = Math.max(28, Math.min(opts.baseItemSize, Math.floor(room / items.length)));
    peak = base * (opts.magnification / opts.baseItemSize);
    panel.style.setProperty('--dock-size', `${base}px`);
    items.forEach((it) => { it.size = base; it.velocity = 0; it.target = base; it.el.style.width = it.el.style.height = ''; });
  }

  const magnifies = () => canHover.matches && !reduceMotion.matches;

  function setTargets() {
    items.forEach((it) => {
      if (!magnifies() || mouseX === Infinity) { it.target = base; return; }
      const rect = it.el.getBoundingClientRect();
      const d = Math.abs(mouseX - (rect.left + rect.width / 2));
      // base → peak → base across [-distance, 0, distance]
      it.target = d >= opts.distance ? base : base + (peak - base) * (1 - d / opts.distance);
    });
  }

  function step(now) {
    const { mass, stiffness, damping } = opts.spring;
    let dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 30);
    last = now;
    setTargets();
    let moving = false;
    // Small sub-steps keep the stiff spring stable
    for (; dt > 0; dt -= 1 / 240) {
      const h = Math.min(dt, 1 / 240);
      items.forEach((it) => {
        const accel = (-stiffness * (it.size - it.target) - damping * it.velocity) / mass;
        it.velocity += accel * h;
        it.size += it.velocity * h;
      });
    }
    items.forEach((it) => {
      if (Math.abs(it.size - it.target) < 0.05 && Math.abs(it.velocity) < 0.5) { it.size = it.target; it.velocity = 0; } else moving = true;
      const px = `${it.size.toFixed(2)}px`;
      it.el.style.width = px;
      it.el.style.height = px;
    });
    frame = moving ? requestAnimationFrame(step) : null;
    if (!moving && mouseX === Infinity) items.forEach((it) => { it.el.style.width = it.el.style.height = ''; });
  }
  const run = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); } };

  function onMove(e) { if (!magnifies()) return; mouseX = e.clientX; run(); }
  function onLeave() { mouseX = Infinity; run(); }
  function onResize() { if (frame) { cancelAnimationFrame(frame); frame = null; } mouseX = Infinity; measure(); }

  panel.addEventListener('mousemove', onMove);
  panel.addEventListener('mouseleave', onLeave);
  window.addEventListener('resize', onResize);
  measure();

  return {
    refresh: onResize,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      panel.removeEventListener('mousemove', onMove);
      panel.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
    },
  };
}
