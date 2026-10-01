// Touch plumbing. Everything is pointer-driven, nothing relies on click, and
// every handler cancels the browser's default so a fast double tap never zooms
// the page mid-run.
export function bindInputs(root, onPress, onRelease) {
  const held = new Map(); // pointerId -> action

  const actionOf = (el) => {
    const t = el.closest('[data-act]');
    return t ? { act: t.dataset.act, mode: t.dataset.mode || 'tap', el: t } : null;
  };

  root.addEventListener('pointerdown', (e) => {
    const hit = actionOf(e.target);
    if (!hit) return;
    e.preventDefault();
    // Register the input FIRST. Pointer capture is a nicety; if it throws we
    // must not lose the press -- a swallowed input mid-run is a lost night.
    hit.el.classList.add('is-down');
    held.set(e.pointerId, hit);
    onPress(hit.act);
    try { hit.el.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
  }, { passive: false });

  const up = (e) => {
    const hit = held.get(e.pointerId);
    if (!hit) return;
    held.delete(e.pointerId);
    hit.el.classList.remove('is-down');
    if (hit.mode === 'hold') onRelease(hit.act);
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('lostpointercapture', up);

  // Belt and braces on iOS/older Android webviews.
  root.addEventListener('touchstart', (e) => { if (actionOf(e.target)) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('dblclick', (e) => e.preventDefault());

  return {
    releaseAll() {
      for (const [, hit] of held) { hit.el.classList.remove('is-down'); if (hit.mode === 'hold') onRelease(hit.act); }
      held.clear();
    }
  };
}

// Keep the screen awake and the page full-screen for the length of a run.
export async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}

export function isFullscreen() {
  return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
}

// Browser chrome is not cosmetic here: an address bar showing or hiding resizes
// the viewport, and every control is placed as a percentage of it, so the
// buttons you calibrated move under your thumbs mid-run. Hence the insisting.
//
// Must NOT be awaited-into: requestFullscreen only succeeds while the browser
// still considers itself inside a user gesture, and awaiting anything first
// spends that. Call it synchronously from the handler and let it settle later.
export function goFullscreen(el: any = document.documentElement) {
  if (isFullscreen()) return Promise.resolve(true);
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return Promise.resolve(false);
  let p;
  try { p = req.call(el, { navigationUI: 'hide' }); } catch { return Promise.resolve(false); }
  return Promise.resolve(p)
    .then(() => { (screen.orientation as any)?.lock?.('landscape')?.catch(() => {}); return true; })
    .catch(() => false);
}

export function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }
