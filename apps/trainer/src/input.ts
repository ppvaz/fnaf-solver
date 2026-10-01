// Touch plumbing. Everything is pointer-driven, nothing relies on click, and
// every handler cancels the browser's default so a fast double tap never zooms
// the page mid-run.
/** A pressed control: its action, whether it is tapped or held, and its element. */
interface Hit { readonly act: string, readonly mode: string, readonly el: HTMLElement }

export function bindInputs(root: HTMLElement, onPress: (act: string) => void, onRelease: (act: string) => void) {
  const held = new Map<number, Hit>(); // pointerId -> action

  // Pointer and touch events on the trainer target elements.
  const actionOf = (el: EventTarget | null): Hit | null => {
    const t = (el as Element).closest<HTMLElement>('[data-act]');
    // The selector matched data-act, so the element carries it.
    return t ? { act: t.dataset.act as string, mode: t.dataset.mode || 'tap', el: t } : null;
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

  const up = (e: PointerEvent) => {
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
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// Browser chrome is not cosmetic here: an address bar showing or hiding resizes
// the viewport, and every control is placed as a percentage of it, so the
// buttons you calibrated move under your thumbs mid-run. Hence the insisting.
//
// Must NOT be awaited-into: requestFullscreen only succeeds while the browser
// still considers itself inside a user gesture, and awaiting anything first
// spends that. Call it synchronously from the handler and let it settle later.
export function goFullscreen(el: HTMLElement = document.documentElement) {
  if (isFullscreen()) return Promise.resolve(true);
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return Promise.resolve(false);
  let p: Promise<void> | undefined;
  try { p = req.call(el, { navigationUI: 'hide' }); } catch { return Promise.resolve(false); }
  return Promise.resolve(p)
    .then(() => { screen.orientation?.lock?.('landscape')?.catch(() => {}); return true; })
    .catch(() => false);
}

export function buzz(ms: VibratePattern) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }
