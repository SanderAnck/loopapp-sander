// Small platform checks used by the UI.

/** True on iPhone/iPad (iPadOS reports itself as Mac with touch). */
export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** True when opened from the home screen (no Safari chrome). */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
