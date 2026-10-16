export function windowAvailable(window, quitting = false) {
  return !quitting && !!window && !window.isDestroyed();
}
export function showController(window, { quitting = false, focus = true, application } = {}) {
  if (!windowAvailable(window, quitting)) return false;
  if (focus) {
    if (window.isMinimized()) window.restore();
    window.show();
    application?.focus();
    window.focus();
  } else window.showInactive();
  return true;
}
export function setOverlayInput(window, locked) {
  if (!window || window.isDestroyed()) return;
  // On macOS disabling focus alone does not release existing keyboard focus.
  if (locked && window.isFocused()) window.blur();
  window.setFocusable(!locked);
  window.setIgnoreMouseEvents(locked, { forward: true });
}
export function releaseOverlay(window) {
  if (!window || window.isDestroyed()) return;
  setOverlayInput(window, true);
  window.hide();
}
export function showStartupOverlay(window, { hidden = false, quitting = false } = {}) {
  if (hidden || !windowAvailable(window, quitting)) return false;
  setOverlayInput(window, true);
  window.showInactive();
  return true;
}
