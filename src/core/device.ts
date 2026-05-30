/**
 * Is the primary pointing device a touchscreen? `(pointer: coarse)` is true on
 * phones/tablets and false on a desktop even when a touchscreen is attached, so
 * mouse+keyboard players keep their controls while phones get the on-screen
 * pad. Guarded for non-browser contexts (tests / SSR).
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return hasTouch && coarse;
}
