// Shared controller for the floating village companion (阿樟).
// One logical companion for the whole launch: position, minimized state,
// introduction cooldowns and the page context live here, so every page's
// <village-pet> instance renders the same companion instead of a new one.
//
// Persistence: one new namespaced key, STORE_KEY. Existing keys are never touched.
const STORE_KEY = 'guyuan-pet-v1';
const COOLDOWN_MS = 5 * 60 * 1000;   // the same topic is not introduced again within five minutes
const INTRO_DELAY_MS = 900;          // settle time before a proactive introduction; rapid scene changes cancel it
const HINT_LAUNCHES = 3;             // the gesture hint is offered on the first three launches

// Overlay host. The companion is rendered through <root-portal> (base library 2.25.2+),
// which moves it out of the page and component tree to the page root, so no ancestor
// can clip it or trap it in a lower stacking context. Set PORTAL to false to render it
// in place (the styles are the same). Layer order is documented in village-pet/index.wxss.
const PORTAL = true;
function overlayPortal() {
  if (!PORTAL) return false;
  try { return typeof wx.canIUse !== 'function' || wx.canIUse('root-portal') !== false; } catch (error) { return false; }
}
// Route policy. mode: full (proactive), quiet (no unsolicited text), compact (smaller and quiet).
// reserve: bottom clearance in rpx on top of the device safe area.
const ROUTES = {
  'pages/guide/index': { mode: 'full', kind: 'map', tab: true, reserve: 196 },
  'pages/village/index': { mode: 'full', kind: 'village', tab: true, reserve: 196 },
  'pages/panorama/index': { mode: 'full', kind: 'panorama', reserve: 36 },
  'pages/place/index': { mode: 'full', kind: 'place', reserve: 36 },
  'pages/visit/index': { mode: 'full', kind: 'route', reserve: 36 },
  'pages/cards/index': { mode: 'quiet', kind: 'cards', reserve: 36 },
  'pages/postcard/index': { mode: 'quiet', kind: 'postcard', reserve: 36 },
  'pages/gallery/index': { mode: 'compact', kind: 'gallery', reserve: 372 }
};
// Commerce and personal pages: the component is not in their templates at all.
const EXCLUDED = ['pages/shop/index', 'pages/product/index', 'pages/checkout/index', 'pages/profile/index'];
// <web-view> is a native component that always covers the whole page; a normal
// view cannot be drawn above it and nothing can be injected into the third-party tour.
const UNSUPPORTED = ['pages/webview/index'];
// Topics introduced at most once per launch.
const ONCE = { greet: true, route: true };

const routeOf = page => String(page && (page.route || page.__route__) || '').replace(/^\//, '');
function policy(route) {
  const key = String(route || '').replace(/^\//, '');
  if (ROUTES[key]) return Object.assign({ visible: true, route: key }, ROUTES[key]);
  if (UNSUPPORTED.includes(key)) return { visible: false, route: key, reason: 'native-web-view' };
  return { visible: false, route: key, reason: EXCLUDED.includes(key) ? 'commerce-or-personal' : 'not-a-tourism-page' };
}

const state = {
  side: 'right', y: 0.66, minimized: false, hintCount: 0, hintShownThisLaunch: false,
  introAt: {}, dismissed: {}, taps: 0, celebration: null, foregrounded: false
};
let loaded = false, appHooked = false, serial = 0;
function load() {
  if (loaded) return state;
  loaded = true;
  try {
    const saved = wx.getStorageSync(STORE_KEY);
    if (saved && typeof saved === 'object') {
      if (saved.side === 'left' || saved.side === 'right') state.side = saved.side;
      if (typeof saved.y === 'number' && saved.y >= 0 && saved.y <= 1) state.y = saved.y;
      state.minimized = saved.minimized === true;
      if (Number.isInteger(saved.hintCount) && saved.hintCount >= 0) state.hintCount = saved.hintCount;
    }
  } catch (error) { /* storage unavailable: defaults apply for this launch */ }
  return state;
}
function save() {
  try { wx.setStorageSync(STORE_KEY, { side: state.side, y: state.y, minimized: state.minimized, hintCount: state.hintCount }); }
  catch (error) { /* a preference that cannot be saved is not worth a toast */ }
}
// App foreground is told apart from returning out of a linked page.
function hookApp() {
  if (appHooked) return;
  appHooked = true;
  if (typeof wx !== 'undefined' && typeof wx.onAppShow === 'function') wx.onAppShow(() => { state.foregrounded = true; });
}
function takeForeground() { const value = state.foregrounded; state.foregrounded = false; return value; }

// ---- page context ---------------------------------------------------------
// topic: what a proactive introduction would be about (0..3, 'village', 'route', 'greet') or null on quiet pages.
// place: what the chat should treat as "here" (0..3, 'village') or null.
// Pages call enter() from onLoad and after every successful in-page change of scenic point.
function enter(page, options) {
  if (!page) return null;
  const next = options || {};
  const before = page.__petContext || null;
  const topic = next.topic === undefined ? null : next.topic;
  const place = next.place === undefined ? null : next.place;
  const changed = !before || before.topic !== topic;
  const context = { topic, place, kind: policy(routeOf(page)).kind || '', seq: ++serial, pending: changed ? false : before.pending };
  page.__petContext = context;
  const host = page.__petHost;
  if (host && typeof host.contextChanged === 'function') host.contextChanged(context, !before ? 'initial' : changed ? 'switch' : 'same');
  return context;
}
const context = page => page && page.__petContext || null;
function bind(page, host) { if (page) page.__petHost = host; hookApp(); }
function unbind(page, host) { if (page && page.__petHost === host) page.__petHost = null; }

// reason: initial | switch | same | return | foreground
function decideIntro(ctx, mode, reason, now) {
  const no = why => ({ play: false, why });
  if (!ctx || ctx.topic === null || ctx.topic === undefined) return no('quiet-page');
  if (mode !== 'full') return no('quiet-mode');
  if (state.minimized) return no('minimized');
  if (state.dismissed[ctx.topic]) return no('dismissed');
  const last = state.introAt[ctx.topic];
  if (last !== undefined && (ONCE[ctx.topic] || now - last < COOLDOWN_MS)) return no('cooldown');
  if (reason === 'initial' || reason === 'switch') return { play: true, why: reason };
  if (ctx.pending) return { play: true, why: 'pending-from-' + reason };
  return no(reason);
}
function markIntroduced(topic, now) { state.introAt[topic] = now; }
function dismiss(topic) { if (topic !== null && topic !== undefined) state.dismissed[topic] = true; }

// ---- chat -------------------------------------------------------------------
function chatContext(page) {
  const ctx = context(page);
  if (!ctx || ctx.place === null || ctx.place === undefined) return null;
  return { place: ctx.place };
}
// Called by whichever guide layer is on that page (tab bar or companion host).
// The flag is per page: a chat left open on one page must not hide the companion
// on a page opened from it.
function chatPhase(page, phase) {
  if (!page) return;
  const open = !['idle', 'leaving'].includes(phase);
  page.__petChatOpen = open;
  const host = page.__petHost;
  if (host && typeof host.chatChanged === 'function') host.chatChanged(open, phase);
}
const chatOpenOn = page => !!(page && page.__petChatOpen);

// ---- small shared state ---------------------------------------------------------
function setPosition(side, y) { state.side = side === 'left' ? 'left' : 'right'; state.y = Math.min(1, Math.max(0, y)); save(); }
function setMinimized(value) { state.minimized = !!value; save(); }
function wantHint() { return !state.hintShownThisLaunch && state.hintCount < HINT_LAUNCHES; }
function hintShown() { if (state.hintShownThisLaunch) return; state.hintShownThisLaunch = true; state.hintCount += 1; save(); }
function nextTap() { return state.taps++; }
function celebrate(kind) { state.celebration = kind || 'collect'; }
function takeCelebration() { const value = state.celebration; state.celebration = null; return value; }
// Test hook: a fresh launch.
function resetForTest() {
  Object.assign(state, { side: 'right', y: 0.66, minimized: false, hintCount: 0, hintShownThisLaunch: false, introAt: {}, dismissed: {}, taps: 0, celebration: null, foregrounded: false });
  loaded = false;
}
module.exports = {
  STORE_KEY, COOLDOWN_MS, INTRO_DELAY_MS, HINT_LAUNCHES, ROUTES, EXCLUDED, UNSUPPORTED,
  state, load, policy, routeOf, overlayPortal, enter, context, bind, unbind, decideIntro, markIntroduced, dismiss,
  chatContext, chatPhase, chatOpenOn, setPosition, setMinimized, wantHint, hintShown, nextTap, celebrate, takeCelebration, takeForeground, resetForTest
};
