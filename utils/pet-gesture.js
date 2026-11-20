// Gesture arbitration for the floating companion. Pure logic: no wx, no DOM.
//
// One touch sequence resolves to exactly one of:
//   tap        released before LONG_PRESS_MS without moving past MOVE_CANCEL_PX
//   long press held for LONG_PRESS_MS without moving past MOVE_CANCEL_PX (fires once, at the threshold)
//   drag       moved past MOVE_CANCEL_PX before the long press was recognized
//
// Rules:
//   - A recognized long press suppresses the tap on release and ignores later movement.
//   - Movement past the threshold cancels long-press recognition for the rest of the touch.
//   - touchcancel, a second finger, or reset() end the sequence without tap or long press.
//   - Taps closer together than TAP_GAP_MS are dropped, so a burst cannot queue reactions.
//   - A new touchstart while a sequence is still open (its end was never delivered)
//     discards the old sequence first, so the recognizer cannot get stuck.
const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 9;
const TAP_GAP_MS = 220;

function create(handlers, options) {
  const h = handlers || {};
  const o = Object.assign({ longPressMs: LONG_PRESS_MS, moveCancelPx: MOVE_CANCEL_PX, tapGapMs: TAP_GAP_MS }, options || {});
  let phase = 'idle'; // idle | pressing | dragging | held
  let startX = 0, startY = 0, timer = null, lastTap = -Infinity;
  const call = (name, arg) => { if (typeof h[name] === 'function') h[name](arg); };
  const disarm = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  function finish(notify) {
    const was = phase;
    disarm();
    phase = 'idle';
    if (was !== 'idle' && notify) call('onPressEnd', was);
    return was;
  }
  return {
    phase() { return phase; },
    pending() { return timer !== null; },
    // point: { x, y, count } where count is the number of fingers on the screen
    start(point) {
      if (phase !== 'idle') { const was = finish(true); if (was === 'dragging') call('onDragEnd', { cancelled: true }); }
      if (point.count > 1) return false;
      phase = 'pressing';
      startX = point.x; startY = point.y;
      call('onPressStart', { x: startX, y: startY });
      timer = setTimeout(() => {
        timer = null;
        if (phase !== 'pressing') return;
        phase = 'held';
        call('onLongPress', { x: startX, y: startY });
      }, o.longPressMs);
      return true;
    },
    move(point) {
      if (phase === 'idle' || phase === 'held') return;
      if (point.count > 1) { this.cancel(); return; }
      if (phase === 'pressing') {
        const dx = point.x - startX, dy = point.y - startY;
        if (dx * dx + dy * dy <= o.moveCancelPx * o.moveCancelPx) return;
        disarm();
        phase = 'dragging';
        call('onDragStart', { x: startX, y: startY });
      }
      call('onDragMove', { x: point.x, y: point.y, dx: point.x - startX, dy: point.y - startY });
    },
    end() {
      const was = finish(false);
      if (was === 'pressing') {
        const now = Date.now();
        if (now - lastTap >= o.tapGapMs) { lastTap = now; call('onTap'); }
      } else if (was === 'dragging') call('onDragEnd', { cancelled: false });
      if (was !== 'idle') call('onPressEnd', was);
    },
    cancel() {
      const was = finish(false);
      if (was === 'dragging') call('onDragEnd', { cancelled: true });
      if (was !== 'idle') call('onPressEnd', was);
    },
    // Used on route changes and when the chat opens: no callbacks except the drag commit.
    reset() { this.cancel(); }
  };
}
module.exports = { create, LONG_PRESS_MS, MOVE_CANCEL_PX, TAP_GAP_MS };
