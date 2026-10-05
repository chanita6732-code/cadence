/* =========================================================
   GooeyNav — a gooey burst of particles on the menu item you press (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <GooeyNav /> React component by React Bits
   (https://reactbits.dev). Same particle options, without React:

     const gooey = createGooeyNav({
       selector: '.dock-item, .segmented button',   // items that get the effect
       particleCount: 15,
       particleDistances: [90, 10],   // px from the centre: where particles start / end
       particleR: 100,                // how much they swirl on the way in
       animationTime: 600,            // ms
       timeVariance: 300,             // ms
       colors: [1, 2, 3, 1, 2, 3, 1, 4],   // picks --color-1 … --color-4 (style.css)
       ignore: 'dialog *',            // items matching this are left alone
     });
     gooey.destroy();

   Differences from the original: it decorates the menus that already exist
   (dock, segmented tabs) instead of rendering its own list, so their own
   active styles stay; the pill melts away after the burst; the "goo" is an
   SVG filter with a transparent background, so it works on the light theme
   too (the original needs a black backdrop); and it is skipped for people
   who prefer reduced motion. Styles live in style.css ("Gooey nav").
   ========================================================= */
'use strict';

function createGooeyNav(options = {}) {
  const opts = {
    selector: '.gooey-item', particleCount: 15, particleDistances: [90, 10], particleR: 100,
    animationTime: 600, timeVariance: 300, colors: [1, 2, 3, 1, 2, 3, 1, 4], ignore: 'dialog *',
    ...options,
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set();

  // The goo: blur everything, then sharpen the alpha so nearby blobs fuse together
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  svg.innerHTML = '<defs><filter id="gooey-filter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
    + '<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>'
    + '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"/>'
    + '</filter></defs>';
  document.body.appendChild(svg);

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };
  const noise = (n = 1) => n / 2 - Math.random() * n;

  function getXY(distance, pointIndex, totalPoints) {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  }

  function createParticle(i, time) {
    const d = opts.particleDistances, r = opts.particleR;
    const rotate = noise(r / 10);
    return {
      start: getXY(d[0], opts.particleCount - i, opts.particleCount),
      end: getXY(d[1] + noise(7), opts.particleCount - i, opts.particleCount),
      time,
      scale: 1 + noise(0.2),
      color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
    };
  }

  function clear(item) {
    item.querySelectorAll(':scope > .gooey-fx').forEach((el) => el.remove());
    item.classList.remove('gooey-on');
  }

  function burst(item) {
    clear(item);
    const life = opts.animationTime * 2 + opts.timeVariance;
    const fx = document.createElement('span');
    fx.className = 'gooey-fx';
    fx.setAttribute('aria-hidden', 'true');
    fx.style.setProperty('--life', `${life}ms`);
    const pill = document.createElement('span');
    pill.className = 'gooey-pill';
    pill.style.borderRadius = getComputedStyle(item).borderRadius;
    fx.appendChild(pill);

    for (let i = 0; i < opts.particleCount; i++) {
      const p = createParticle(i, opts.animationTime * 2 + noise(opts.timeVariance * 2));
      const particle = document.createElement('span');
      const point = document.createElement('span');
      particle.className = 'gooey-particle';
      point.className = 'gooey-point';
      particle.style.setProperty('--start-x', `${p.start[0]}px`);
      particle.style.setProperty('--start-y', `${p.start[1]}px`);
      particle.style.setProperty('--end-x', `${p.end[0]}px`);
      particle.style.setProperty('--end-y', `${p.end[1]}px`);
      particle.style.setProperty('--time', `${p.time}ms`);
      particle.style.setProperty('--scale', `${p.scale}`);
      particle.style.setProperty('--color', `var(--color-${p.color}, white)`);
      particle.style.setProperty('--rotate', `${p.rotate}deg`);
      particle.appendChild(point);
      fx.appendChild(particle);
      later(() => particle.remove(), p.time);
    }

    item.classList.add('gooey-item', 'gooey-on');
    item.prepend(fx);
    // Hand the item back to its own colours while the pill melts away
    later(() => { if (fx.isConnected) item.classList.remove('gooey-on'); }, life - 300);
    later(() => fx.remove(), life + 50);
  }

  function onClick(e) {
    if (reduceMotion.matches || !(e.target instanceof Element)) return;
    const item = e.target.closest(opts.selector);
    if (!item || item.disabled || (opts.ignore && item.matches(opts.ignore))) return;
    burst(item);
  }

  // Capture phase: runs even when a handler stops the event
  document.addEventListener('click', onClick, true);

  return {
    update(next) { Object.assign(opts, next); },
    destroy() {
      document.removeEventListener('click', onClick, true);
      timers.forEach(clearTimeout);
      timers.clear();
      document.querySelectorAll('.gooey-fx').forEach((el) => el.remove());
      document.querySelectorAll('.gooey-on').forEach((el) => el.classList.remove('gooey-on'));
      svg.remove();
    },
  };
}
