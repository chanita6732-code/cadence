/* =========================================================
   BorderGlow — card edges glow toward the pointer (plain JavaScript)
   ---------------------------------------------------------
   Ported from the <BorderGlow /> React component by React Bits
   (https://reactbits.dev). The original wraps content in its own card;
   here the effect is added to the cards the app already has:

     const glow = createBorderGlow({ selector: '.card, .auth-card' });
     glow.destroy();

   - Every matching element gets the class `glow-card` and a
     <span class="edge-light"> for the outer glow (also when cards are
     re-rendered later).
   - One pointer listener for the whole page sets two CSS variables on the
     card under the pointer: --edge-proximity (0–100) and --cursor-angle.
   - Colours, radius and sensitivity are CSS variables in style.css
     (see "Border glow"), so they follow the theme.
   Only active on devices with a real pointer (hover).
   ========================================================= */
'use strict';

function createBorderGlow({ selector = '.card' } = {}) {
  const canHover = window.matchMedia('(hover: hover)');
  if (!canHover.matches) return { destroy() {} };

  function prepare(card) {
    if (card.classList.contains('glow-card') && card.querySelector(':scope > .edge-light')) return;
    card.classList.add('glow-card');
    const light = document.createElement('span');
    light.className = 'edge-light';
    light.setAttribute('aria-hidden', 'true');
    // Inline so it can never take part in layout, whatever stylesheet is loaded
    light.style.cssText = 'position:absolute;pointer-events:none';
    card.prepend(light);
  }
  const prepareAll = (root) => {
    if (root.matches?.(selector)) prepare(root);
    root.querySelectorAll?.(selector).forEach(prepare);
  };

  // Cards are re-rendered as data changes; keep them equipped
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; prepareAll(document.body); });
  });

  let pending = null;
  let frame = null;
  function apply() {
    frame = null;
    if (!pending) return;
    const { card, x, y } = pending;
    const rect = card.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const dx = x - rect.left - cx, dy = y - rect.top - cy;
    // How close the pointer is to the edge (0 = centre, 1 = on the edge)
    const kx = dx !== 0 ? cx / Math.abs(dx) : Infinity;
    const ky = dy !== 0 ? cy / Math.abs(dy) : Infinity;
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  }
  function onMove(e) {
    const card = e.target.closest?.('.glow-card');
    if (!card) return;
    pending = { card, x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  }

  prepareAll(document.body);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointermove', onMove, { passive: true });

  return {
    destroy() {
      observer.disconnect();
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
