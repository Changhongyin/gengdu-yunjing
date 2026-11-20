// Logic checks for the floating village companion: route policy, gesture
// arbitration, proactive introductions, cooldown and cancellation, the shared
// conversation with scenic context, cleanup, and knowledge grounding.
// Pure Node: it mocks wx, Page and Component and uses a virtual clock. It does
// not render anything and is not a substitute for WeChat DevTools or a device.
// Usage: node scripts/check-pet.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const read = file => fs.readFileSync(file, 'utf8');
const results = [];
const section = (name, fn) => { fn(); results.push(name); console.log('PASS: ' + name); };

// ---- virtual clock ---------------------------------------------------------
let now = 0, seq = 0;
const timers = new Map();
global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
global.clearTimeout = id => { timers.delete(id); };
const realNow = Date.now;
Date.now = () => 1700000000000 + now;
function advance(ms) {
  const target = now + ms;
  for (;;) {
    let next = null;
    for (const [id, timer] of timers) if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { id, timer };
    if (!next) break;
    timers.delete(next.id);
    now = next.timer.at;
    next.timer.fn();
  }
  now = target;
}

// ---- wx / Page / Component mocks ---------------------------------------------
const calls = { switchTab: [], navigateTo: [], redirectTo: [], request: [], title: [], toast: [], vibrate: 0 };
let storage = {};
let appShow = null;
const WINDOW = { windowWidth: 390, windowHeight: 753, screenHeight: 844, safeArea: { bottom: 810 } };
global.wx = {
  cloud: { init() {}, downloadFile(o) { o.success({ tempFilePath: '/test/image.jpg' }); } },
  switchTab: o => calls.switchTab.push(o.url), navigateTo: o => calls.navigateTo.push(o.url), redirectTo: o => calls.redirectTo.push(o.url), navigateBack() {},
  setNavigationBarTitle: o => calls.title.push(o.title), hideKeyboard() {},
  getStorageSync: k => storage[k] === undefined ? undefined : JSON.parse(JSON.stringify(storage[k])), setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  showToast: o => calls.toast.push(o.title), showModal() {}, pageScrollTo() {}, showActionSheet() {},
  getWindowInfo: () => WINDOW, vibrateShort: () => { calls.vibrate++; }, onAppShow: fn => { appShow = fn; },
  request: o => { calls.request.push(o); return { abort() {}, onChunkReceived() {} }; }
};
global.getApp = () => ({ globalData: { panoramaUrl: 'https://example.invalid/' } });
function applyData(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let ref = target;
    for (const part of parts.slice(0, -1)) ref = ref[part];
    ref[parts[parts.length - 1]] = value;
  }
}
let definition;
global.Component = d => { definition = d; };
global.Page = d => { definition = d; };
function load(file) { delete require.cache[require.resolve(file)]; require(file); return definition; }
function mountComponent(def, children) {
  const inst = { data: JSON.parse(JSON.stringify(def.data)), listeners: {}, sets: 0,
    setData(patch) { this.sets++; applyData(this.data, patch); },
    triggerEvent(name, detail) { (this.listeners[name] || []).forEach(fn => fn({ detail })); },
    selectComponent(id) { return (children || {})[id] || null; },
    createSelectorQuery() { const q = { select: () => q, boundingClientRect: fn => { fn({ height: 600 }); return q; }, exec() {} }; return q; } };
  for (const [name, fn] of Object.entries(def.methods || {})) inst[name] = fn.bind(inst);
  if (def.lifetimes && def.lifetimes.created) def.lifetimes.created.call(inst);
  return inst;
}
const agentDef = load('../components/guide-agent/index.js');
const barDef = load('../custom-tab-bar/index.js');
const petDef = load('../components/village-pet/index.js');
const session = require('../utils/guide-session');
const config = require('../utils/guide-config');
const retrieval = require('../utils/guide-retrieval');
const prompt = require('../utils/guide-prompt');
const knowledge = require('../utils/guide-knowledge');
const entry = require('../utils/guide-entry');
const pet = require('../utils/pet-controller');
const gestures = require('../utils/pet-gesture');
const intros = require('../utils/pet-intros');
const store = require('../utils/store');
const { places, village } = require('../utils/places');
const backOwner = require('../utils/guide-back');
const TABS = ['pages/guide/index', 'pages/village/index', 'pages/shop/index', 'pages/profile/index'];
// every guide layer instance created by openPage, to count mounted back catchers across the app
let allAgents = [];
const catchers = () => allAgents.filter(a => a.data.containerMounted).length;
const cover = (view, value) => { view.pet.setData({ covered: value }); view.pet.coverChanged(value); };

let pages = [];
global.getCurrentPages = () => pages;
// Opens a page the way the platform does: components attach, then onLoad, onShow, ready.
// lateAttach reverses the first two steps (the companion must not depend on the order).
function openPage(route, options, flags) {
  const def = load('../' + route + '.js');
  const page = { route, data: JSON.parse(JSON.stringify(def.data)),
    setData(patch, callback) { applyData(this.data, patch); if (callback) callback.call(this); } };
  for (const [name, fn] of Object.entries(def)) if (typeof fn === 'function') page[name] = fn.bind(page);
  if (flags && flags.replace) pages = pages.slice(0, -1);
  pages = pages.concat(page);
  const tab = TABS.includes(route);
  const view = { page, route, pet: null, agent: null, bar: null };
  const attach = () => {
    if (tab) {
      view.agent = mountComponent(agentDef);
      view.bar = mountComponent(barDef, { '#guide': view.agent });
      view.agent.listeners.phase = [e => view.bar.onPhase(e)];
      page.getTabBar = () => view.bar;
      agentDef.lifetimes.attached.call(view.agent);
      barDef.lifetimes.attached.call(view.bar);
    }
    if (read(route + '.wxml').includes('<village-pet')) {
      const children = {};
      if (!tab) { view.agent = mountComponent(agentDef); agentDef.lifetimes.attached.call(view.agent); children['#pet-guide'] = view.agent; }
      view.pet = mountComponent(petDef, children);
      view.pet.data.docked = wxmlOf(route).includes('docked="{{true}}"');
      if (!tab) view.agent.listeners.phase = [e => view.pet.onGuidePhase(e)];
      petDef.lifetimes.attached.call(view.pet);
    }
  };
  if (flags && flags.lateAttach) { if (page.onLoad) page.onLoad(options || {}); attach(); }
  else { attach(); if (page.onLoad) page.onLoad(options || {}); }
  if (view.agent) allAgents.push(view.agent);
  showPage(view);
  if (view.pet) petDef.lifetimes.ready.call(view.pet);
  return view;
}
function showPage(view) {
  if (view.page.onShow) view.page.onShow();
  if (view.agent && !view.bar) agentDef.pageLifetimes.show.call(view.agent);
  if (view.pet) petDef.pageLifetimes.show.call(view.pet);
}
function hidePage(view) {
  if (view.page.onHide) view.page.onHide();
  if (view.agent && !view.bar) agentDef.pageLifetimes.hide.call(view.agent);
  if (view.pet) petDef.pageLifetimes.hide.call(view.pet);
}
function closePage(view) {
  hidePage(view);
  if (view.page.onUnload) view.page.onUnload();
  if (view.pet) petDef.lifetimes.detached.call(view.pet);
  if (view.agent) agentDef.lifetimes.detached.call(view.agent);
  pages = pages.filter(p => p !== view.page);
}
function fresh() {
  pages = []; timers.clear(); storage = {}; allAgents.forEach(a => backOwner.release(a)); allAgents = [];
  session.reset(); session.state.introPlayed = false; session.setContext(null);
  config.setForTest({ mode: 'demo' });
  pet.resetForTest();
  store.save({ collected: [0] });
  for (const key of Object.keys(calls)) { if (Array.isArray(calls[key])) calls[key].length = 0; else calls[key] = 0; }
}
const down = (view, x, y, fingers) => view.pet.touchStart({ touches: Array.from({ length: fingers || 1 }, () => ({ clientX: x, clientY: y })) });
const move = (view, x, y) => view.pet.touchMove({ touches: [{ clientX: x, clientY: y }] });
const up = view => view.pet.touchEnd({ touches: [], changedTouches: [{}] });
const tap = view => { down(view, 350, 500); advance(60); up(view); };
const hold = (view, ms) => { down(view, 350, 500); advance(ms === undefined ? gestures.LONG_PRESS_MS : ms); };
const center = view => ({ x: view.pet.data.x + view.pet.data.w / 2, y: view.pet.data.y + view.pet.data.h / 2 });
const bubbleText = view => view.pet.data.bubble ? view.pet.data.bubble.text : '';
const wxmlOf = route => read(route + '.wxml');

// ---- 1. route policy, registration, packaging ------------------------------------
section('route policy: one companion on the eight tourism pages, nothing on commerce, profile or the web-view page', () => {
  const app = JSON.parse(read('app.json'));
  assert(!app.usingComponents || !app.usingComponents['village-pet'], 'the companion is registered per page, never globally');
  const spec = path.resolve(root, '..', 'Claude_Pet_Handoff', 'ROUTE_POLICY.json');
  if (fs.existsSync(spec)) {
    const policy = JSON.parse(read(spec));
    assert.deepEqual(policy.eligible.map(r => r.route).sort(), Object.keys(pet.ROUTES).sort(), 'eligible routes equal the handoff route policy');
    assert.deepEqual(policy.excluded.map(r => r.route).sort(), pet.EXCLUDED.slice().sort(), 'excluded routes equal the handoff route policy');
    assert.deepEqual(policy.needs_native_capability_review.map(r => r.route), pet.UNSUPPORTED);
  } else console.log('NOTE: handoff ROUTE_POLICY.json not found next to the project; comparing against the built-in policy only.');
  for (const route of app.pages) {
    const rule = pet.policy(route), markup = wxmlOf(route), json = JSON.parse(read(route + '.json'));
    const registered = !!(json.usingComponents && json.usingComponents['village-pet']);
    const used = (markup.match(/<village-pet/g) || []).length;
    if (rule.visible) {
      assert.equal(used, 1, route + ' renders exactly one companion');
      assert.equal(registered, true, route + '.json registers the component');
      assert(/^<page-meta page-style="\{\{guideLock\}\}"\/>\r?\n<view class="[^"]*\{\{guideMotion\}\}">/.test(markup), route + ': page-meta first, root view binds guideMotion');
      if (route !== 'pages/panorama/index') {
        assert(/<\/view>\r?\n<village-pet id="pet"(?: covered="\{\{\w+\}\}")?\/>\s*$/.test(markup), route + ': the floating companion follows the page root');
      }
      const def = load('../' + route + '.js');
      assert.equal(def.data.guideMotion, ''); assert.equal(def.data.guideLock, '');
      assert(['full', 'quiet', 'compact'].includes(rule.mode));
    } else {
      assert.equal(used, 0, route + ' must not contain the companion');
      assert.equal(registered, false, route + ' must not register the companion');
      assert(!/pet-controller|village-pet/.test(read(route + '.js')), route + '.js must not touch the companion');
    }
  }
  for (const route of pet.EXCLUDED) assert.equal(pet.policy(route).reason, 'commerce-or-personal');
  assert.equal(pet.policy('pages/webview/index').reason, 'native-web-view');
  assert.equal(pet.policy('/pages/panorama/index').visible, true, 'a leading slash is tolerated');
  assert(!/village-pet|vp-/.test(read('custom-tab-bar/index.wxml')), 'the companion is not mounted in the custom tab bar');
  assert(/<web-view/.test(wxmlOf('pages/webview/index')));
  // quiet pages have no proactive topic; panorama, place and visit set theirs in code
  assert.deepEqual(Object.entries(pet.ROUTES).filter(([, r]) => r.mode !== 'full').map(([k]) => k).sort(), ['pages/cards/index', 'pages/gallery/index', 'pages/postcard/index']);
  // static titles used to restore the navigation bar mirror the page configuration
  for (const [route, title] of Object.entries(entry.PAGE_TITLES)) assert.equal(JSON.parse(read(route + '.json')).navigationBarTitleText, title, route + ' title');
  // files, packaging, runtime constraints
  const upload = JSON.parse(read('output/upload-audit.json'));
  const runtime = ['components/village-pet/index.js', 'utils/pet-controller.js', 'utils/pet-gesture.js', 'utils/pet-intros.js'];
  for (const file of [...runtime, 'components/village-pet/index.json', 'components/village-pet/index.wxml', 'components/village-pet/index.wxss', 'assets/pet/azhang-poses.png']) {
    assert(fs.existsSync(file), 'missing ' + file);
    assert(upload.retainedFiles.includes(file), 'not packaged: ' + file + ' (run prepare-upload.cjs and check-upload.cjs first)');
  }
  assert(!upload.retainedFiles.some(f => /character-reference|^docs\/.*pose-\w+\.png|build-pet-assets/.test(f)), 'the reference sheet and build tools stay out of the package');
  for (const file of runtime) {
    const code = read(file).replace(/\/\/.*$/gm, '');
    for (const banned of [/\bfetch\s*\(/, /\bdocument\./, /\bwindow\./, /XMLHttpRequest/, /\bprocess\./, /require\(['"]node:/, /localStorage/, /wx\.request\s*\(/, /wx\.previewImage\s*\(/, /createInnerAudioContext|playVoice|TTS/i, /setInterval/]) assert(!banned.test(code), file + ' uses ' + banned);
  }
  const css = read('components/village-pet/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const rule of css.split('}')) {
    const selector = rule.split('{')[0].trim();
    if (!selector) continue;
    for (const part of selector.split(',')) assert(/^(\s*\.[\w-]+)+$/.test(part.replace(/\s+/g, ' ')), 'component selectors must be class-only, got "' + part.trim() + '"');
  }
  const markup = read('components/village-pet/index.wxml');
  assert.equal((markup.match(/src="\/assets\/pet\/azhang-poses\.png"/g) || []).length, 2, 'the character always comes from the supplied-character sheet');
  assert(!/character-reference/.test(markup), 'the whole reference sheet is never displayed');
  // touch handlers sit on the character only; nothing full-screen, no native tap or longpress binding on it
  const body = markup.match(/<view wx:if="\{\{!minimized\}\}" class="vp-body[^>]*>/)[0];
  for (const binding of ['bindtouchstart="touchStart"', 'catchtouchmove="touchMove"', 'bindtouchend="touchEnd"', 'bindtouchcancel="touchCancel"']) assert(body.includes(binding), 'character binds ' + binding);
  assert(!/bind:?tap|bind:?longpress|bind:?longtap/.test(body), 'tap and long press are arbitrated in pet-gesture.js, not by native events');
  assert(!/\.vp\s*\{[^}]*(?:inset\s*:\s*0|right\s*:\s*0[^.]|bottom\s*:\s*0)/.test(read('components/village-pet/index.wxss')), 'the fixed box is never stretched over the page');
  assert(pet.STORE_KEY === 'guyuan-pet-v1' && !['gengdu-yunjing-v1', 'gengdu-place-notes-v1'].includes(pet.STORE_KEY));
  assert.equal(JSON.parse(read('project.config.json')).setting.urlCheck, true, 'request-domain validation stays enabled');
});

// ---- 2. gesture arbitration (pure) ----------------------------------------------
section('gestures: tap, long press once with no tap on release, drag cancels long press, cancel, multi-touch, bursts, stuck recovery', () => {
  timers.clear();
  const log = [];
  const g = gestures.create({ onTap: () => log.push('tap'), onLongPress: () => log.push('long'), onDragStart: () => log.push('drag-start'),
    onDragMove: m => log.push('move:' + m.dx + ',' + m.dy), onDragEnd: e => log.push(e.cancelled ? 'drag-cancel' : 'drag-end'), onPressStart: () => log.push('down'), onPressEnd: () => log.push('up') });
  const take = () => log.splice(0).join(' ');
  assert.equal(gestures.LONG_PRESS_MS, 420); assert.equal(gestures.MOVE_CANCEL_PX, 9); assert.equal(gestures.TAP_GAP_MS, 220);
  // tap
  g.start({ x: 10, y: 10, count: 1 }); advance(120); g.end();
  assert.equal(take(), 'down tap up'); assert.equal(timers.size, 0, 'a tap leaves no timer');
  // release 1 ms before the threshold is still a tap
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); advance(419); g.end();
  assert.equal(take(), 'down tap up');
  // long press: fires exactly at the threshold, once, and the release is silent
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); advance(419); assert.equal(take(), 'down');
  advance(1); assert.equal(take(), 'long'); assert.equal(g.phase(), 'held');
  advance(15000); assert.equal(take(), '', 'an extended hold does not repeat');
  g.move({ x: 200, y: 300, count: 1 }); assert.equal(take(), '', 'movement after recognition is ignored (no drag)');
  g.end(); assert.equal(take(), 'up', 'no tap after a long press'); assert.equal(timers.size, 0);
  // jitter inside the threshold does not cancel the long press
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); g.move({ x: 16, y: 16, count: 1 }); advance(420);
  assert.equal(take(), 'down long'); g.end(); take();
  // drag: movement past 9 px cancels long-press recognition for good
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); advance(200); g.move({ x: 20, y: 10, count: 1 });
  assert.equal(take(), 'down drag-start move:10,0'); assert.equal(timers.size, 0, 'the long-press timer is cancelled when dragging starts');
  g.move({ x: 10, y: 10, count: 1 }); advance(5000);
  assert.equal(take(), 'move:0,0', 'returning to the start point does not re-arm the long press');
  g.end(); assert.equal(take(), 'drag-end up', 'a drag ends with neither tap nor long press');
  // touchcancel while pressing and while dragging
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); advance(100); g.cancel(); advance(5000);
  assert.equal(take(), 'down up'); assert.equal(timers.size, 0);
  g.start({ x: 10, y: 10, count: 1 }); g.move({ x: 40, y: 10, count: 1 }); g.cancel();
  assert.equal(take(), 'down drag-start move:30,0 drag-cancel up');
  // a second finger ends the sequence without tap or long press
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); g.move({ x: 11, y: 10, count: 2 }); advance(5000); g.end();
  assert.equal(take(), 'down up');
  assert.equal(g.start({ x: 10, y: 10, count: 2 }), false, 'a two-finger start is not a companion gesture'); assert.equal(take(), '');
  // rapid taps: bursts are throttled, and never become a long press
  advance(1000);
  for (let i = 0; i < 8; i++) { g.start({ x: 10, y: 10, count: 1 }); advance(40); g.end(); advance(40); }
  const burst = take();
  assert.equal((burst.match(/long/g) || []).length, 0);
  assert.equal((burst.match(/tap/g) || []).length, 3, 'eight taps in 640 ms give three reactions (220 ms gap)');
  // route change while recognition is pending
  advance(1000); g.start({ x: 10, y: 10, count: 1 }); advance(300); assert.equal(g.pending(), true); g.reset();
  assert.equal(g.pending(), false); advance(5000); assert.equal(take(), 'down up'); assert.equal(g.phase(), 'idle');
  // a touchend that never arrives cannot leave the recognizer stuck
  g.start({ x: 10, y: 10, count: 1 }); advance(420); assert.equal(take(), 'down long');
  advance(3000); g.start({ x: 10, y: 10, count: 1 }); advance(50); g.end();
  assert.equal(take(), 'up down tap up'); assert.equal(timers.size, 0);
});

// ---- 3. single tap and long press on a tourism tab -----------------------------------
section('tab pages: tap reacts without chat; long press opens the existing layer exactly once; release adds no tap; state returns', () => {
  fresh();
  const tab = openPage('pages/village/index');
  assert.equal(tab.pet.data.visible, true); assert.equal(tab.pet.data.hostGuide, false, 'tab pages reuse the tab bar layer');
  advance(20000); // the proactive village introduction and its bubble are over
  assert.equal(tab.pet.data.bubble, null);
  tap(tab);
  assert.equal(tab.pet.data.bubble.kind, 'react'); assert(bubbleText(tab).length > 0 && bubbleText(tab).length <= 30, 'a short reaction');
  assert.equal(tab.agent.data.phase, 'idle', 'a single tap never opens the chat');
  assert.equal(calls.navigateTo.length + calls.switchTab.length + calls.request.length, 0);
  assert.deepEqual(tab.pet.data.bubble.actions.map(a => a.id), ['intro', 'ask', 'min'], 'the bubble offers replay, an explicit chat action and minimize');
  const first = bubbleText(tab), firstPose = tab.pet.data.pose;
  advance(400); tap(tab);
  assert.notEqual(bubbleText(tab), first, 'the next tap gives a different reaction'); assert.notEqual(tab.pet.data.pose, 'scroll');
  assert(firstPose !== 'scroll', 'a reaction changes the pose');
  for (let i = 0; i < 6; i++) { down(tab, 350, 500); advance(30); up(tab); advance(30); }
  assert.equal(tab.agent.data.phase, 'idle', 'rapid taps never open the chat');
  advance(4200); assert.equal(tab.pet.data.bubble, null, 'the reaction bubble goes away by itself'); assert.equal(tab.pet.data.pose, 'scroll');
  // long press
  tab.page.setData({ slide: 2 });
  const before = { x: tab.pet.data.x, y: tab.pet.data.y };
  hold(tab, 419); assert.equal(tab.agent.data.phase, 'idle'); assert.equal(tab.pet.data.pressing, true);
  advance(1);
  assert.equal(tab.agent.data.phase, 'receding', 'the existing guide layer opens at the long-press threshold');
  assert.equal(calls.vibrate, 1); assert.equal(tab.pet._opens, 1);
  assert.equal(tab.pet.data.away, true, 'the companion steps aside while the chat is open'); assert.equal(tab.bar.data.sunk, true);
  assert.deepEqual(session.state.context, { place: 'village' }); assert.equal(tab.agent.data.contextName, '古渊头村');
  advance(8000); // an extended hold
  assert.equal(tab.agent.data.phase, 'chat'); assert.equal(tab.pet._opens, 1, 'one continuous hold opens one chat');
  up(tab);
  assert.equal(tab.pet.data.bubble, null, 'the release after a long press is not a tap');
  assert.equal(tab.agent.data.phase, 'chat');
  assert.equal(session.state.introPlayed, true);
  // ask something, close, come back
  tab.agent.ask({ currentTarget: { dataset: { question: tab.agent.data.contextQuestion } } }); advance(9000);
  assert.equal(session.state.messages.length, 2); assert.equal(session.state.messages[1].status, 'done'); assert.equal(session.state.messages[1].origin, 'demo');
  assert.equal(tab.agent.close(), true);
  assert.equal(tab.pet.data.away, false, 'the companion returns as the layer leaves');
  advance(520);
  assert.equal(tab.agent.data.phase, 'idle'); assert.equal(tab.bar.data.sunk, false);
  assert.deepEqual({ x: tab.pet.data.x, y: tab.pet.data.y }, before, 'same position'); assert.equal(tab.page.data.slide, 2, 'source page state untouched');
  assert.equal(calls.title[calls.title.length - 1], '古村漫行');
  // second long press: the short intro, the same conversation
  hold(tab); assert.equal(tab.agent.data.short, true); advance(2100); up(tab);
  assert.equal(tab.agent.data.phase, 'chat'); assert.equal(tab.agent.data.messages.length, 2);
  // the center button still works by itself and gets the same layer
  tab.agent.close(); advance(520);
  tab.bar.openGuide(); assert.equal(tab.agent.data.phase, 'receding'); assert.equal(tab.pet.data.away, true);
  hold(tab); up(tab); assert.equal(tab.pet._opens, 2, 'no second layer while one is open');
  tab.agent.close(); advance(520);
  // the explicit chat action in the bubble is the accessible alternative to the long press
  tap(tab); tab.pet.tapAction({ currentTarget: { dataset: { id: 'ask' } } });
  assert.equal(tab.agent.data.phase, 'receding'); assert.equal(tab.pet.data.bubble, null);
  tab.agent.close(); advance(520);
  // shop and profile: no companion, and the center button passes no scenic context
  hidePage(tab);
  const shop = openPage('pages/shop/index');
  assert.equal(shop.pet, null); assert.equal(shop.page.__petHost, undefined); assert.equal(pet.context(shop.page), null);
  assert.equal(timers.size, 0, 'no companion timer survives on a commerce page');
  shop.bar.openGuide(); assert.equal(session.state.context, null); assert.equal(shop.agent.data.contextName, '');
  assert.equal(shop.agent.data.messages.length, 2, 'still the one shared conversation');
  shop.agent.close(); advance(520);
  for (const key of Object.keys(storage)) assert(!/guide/i.test(key), 'the guide still writes no storage');
});

// ---- 4. proactive introductions on the panorama ---------------------------------------
section('panorama: camphor is introduced unprompted and offline; switching follows the real scene; locked and stale scenes say nothing', () => {
  fresh();
  const pano = openPage('pages/panorama/index', { id: '0' });
  assert.equal(pano.pet.data.hostGuide, true, 'non-tab pages host the guide layer in the companion');
  assert.deepEqual(pet.context(pano.page).topic, 0);
  assert.equal(pano.pet.data.bubble, null);
  advance(pet.INTRO_DELAY_MS - 1); assert.equal(pano.pet.data.bubble, null);
  advance(1);
  assert.equal(pano.pet.data.bubble.kind, 'intro'); assert.equal(pano.pet.data.bubble.title, '千年古樟'); assert.equal(pano.pet.data.bubble.tag, '本地讲解资料');
  assert.equal(pano.pet.data.pose, 'point', 'the introducing pose');
  advance(3000);
  const camphor = bubbleText(pano);
  assert.equal(pano.pet.data.bubble.done, true); assert.equal(camphor, intros.get(0).text);
  for (const phrase of ['古樟', '樟树爹', '1220年', '2021年', '挂牌档案']) assert(camphor.includes(phrase), 'camphor introduction mentions ' + phrase);
  assert(/S05 最高人民检察院网站 2021/.test(pano.pet.data.bubble.source) && /知识库第六节/.test(pano.pet.data.bubble.source), 'age is given with source and date');
  assert.equal(calls.request.length, 0, 'no network request for an introduction');
  assert(camphor.length <= 110, 'concise: ' + camphor.length);
  // switch to the water divider: the introduction follows the successful selection
  pano.page.select(1);
  assert.equal(pano.pet.data.bubble, null, 'the previous introduction is withdrawn at once');
  advance(pet.INTRO_DELAY_MS + 3000);
  const water = bubbleText(pano);
  assert.equal(pano.pet.data.bubble.title, '乌竹溪古水秤');
  assert(water.includes('分水石') && water.includes('不是水车') && !water.includes('古樟'));
  assert(!/(?<!不是)水车/.test(water) && !/水轮|秤砣|秤杆/.test(water), 'no wheel or weighing claim');
  // rapid changes: only the final scene speaks
  pano.page.select(0); advance(300); pano.page.select(1); advance(300); pano.page.select(2);
  assert.equal(pano.pet.data.bubble, null); advance(pet.INTRO_DELAY_MS - 1); assert.equal(pano.pet.data.bubble, null);
  advance(1); assert.equal(pano.pet.data.bubble.title, '承启堂');
  advance(3000);
  for (const phrase of ['四份厅', '清道光年间', '现场']) assert(bubbleText(pano).includes(phrase));
  assert(/现场说明牌/.test(pano.pet.data.bubble.source));
  // next() and previous() go through select()
  pano.page.previous(); assert.equal(pet.context(pano.page).topic, 1); pano.page.next(); assert.equal(pet.context(pano.page).topic, 2);
  // a locked scene is rejected by the page and never reaches the companion
  assert.equal(store.unlocked(3), false);
  advance(20000); calls.toast.length = 0;
  const seqBefore = pet.context(pano.page).seq;
  pano.page.select(3); pano.page.next(); pano.page.switchScene({ currentTarget: { dataset: { id: 3 } } });
  assert.equal(calls.toast.length, 3, 'the existing lock rule answers'); assert.equal(pano.page.data.scene.id, 2);
  assert.equal(pet.context(pano.page).seq, seqBefore, 'no context change for an unentered scene'); advance(5000);
  assert.equal(pano.pet.data.bubble, null, 'no introduction for a locked scene');
  pano.page.select(7); pano.page.select(NaN); assert.equal(pet.context(pano.page).topic, 2);
  // once unlocked, the fourth scene is introduced under its current name
  store.collect(1); assert.equal(store.unlocked(3), true);
  pano.page.select(3); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(pano.pet.data.bubble.title, '四本堂');
  assert(bubbleText(pano).includes('四本义塾') && !/供销社/.test(bubbleText(pano)));
  // selecting the scene that is already shown is not a new visit
  advance(20000); pano.page.select(3); advance(5000); assert.equal(pano.pet.data.bubble, null);
  assert.equal(pano.pet.pendingTimers().includes('intro'), false);
  // opening straight into another scene, with the page loading before the component attaches
  fresh(); store.collect(1); store.collect(2);
  const late = openPage('pages/panorama/index', { id: '3' }, { lateAttach: true });
  advance(pet.INTRO_DELAY_MS + 3000); assert.equal(late.pet.data.bubble.title, '四本堂');
  // a locked scene requested by URL falls back to the camphor, and that is what is introduced
  fresh();
  const fallback = openPage('pages/panorama/index', { id: '3' });
  assert.equal(fallback.page.data.scene.id, 0); advance(pet.INTRO_DELAY_MS + 3000); assert.equal(fallback.pet.data.bubble.title, '千年古樟');
});

// ---- 5. cooldown, dismissal, return, foreground ------------------------------------------
section('repetition policy: five-minute cooldown, dismissal for the launch, no repeat on return or foreground, replay on request', () => {
  fresh();
  const pano = openPage('pages/panorama/index', { id: '0' });
  advance(pet.INTRO_DELAY_MS + 3000); assert.equal(pano.pet.data.bubble.kind, 'intro');
  advance(12000); assert.equal(pano.pet.data.bubble, null, 'an unanswered introduction leaves after 12 s'); assert.equal(pano.pet.data.pose, 'scroll');
  // returning from a linked page and foregrounding the same scene do not repeat it
  hidePage(pano); showPage(pano); advance(5000);
  assert.equal(pano.pet.data.bubble, null); assert.equal(pano.pet._decision.why, 'cooldown');
  hidePage(pano); appShow(); showPage(pano); advance(5000); assert.equal(pano.pet.data.bubble, null);
  // the linked introduction page of the same place shares the topic: no second speech there
  hidePage(pano);
  const place = openPage('pages/place/index', { id: '0' });
  advance(5000); assert.equal(place.pet.data.bubble, null); assert.equal(place.pet._decision.why, 'cooldown');
  // ...but replay is one tap away
  tap(place); assert(place.pet.data.bubble.actions.some(a => a.id === 'intro' && a.label === '听讲解'));
  place.pet.tapAction({ currentTarget: { dataset: { id: 'intro' } } }); advance(3000);
  assert.equal(bubbleText(place), intros.get(0).text); assert.equal(place.pet.data.bubble.automatic, false);
  closePage(place); showPage(pano);
  // within the cooldown a different scene still speaks, the same one does not
  pano.page.select(1); advance(pet.INTRO_DELAY_MS + 3000); assert.equal(pano.pet.data.bubble.title, '乌竹溪古水秤');
  pano.page.select(0); advance(5000); assert.equal(pano.pet.data.bubble, null);
  // after the cooldown it may speak again
  advance(pet.COOLDOWN_MS); pano.page.select(1); advance(pet.INTRO_DELAY_MS + 3000); assert.equal(pano.pet.data.bubble.title, '乌竹溪古水秤');
  // dismissing with the close button silences that topic for the launch, even after the cooldown
  pano.pet.closeBubble(); assert.equal(pano.pet.data.bubble, null);
  advance(pet.COOLDOWN_MS * 2); pano.page.select(0); advance(pet.INTRO_DELAY_MS + 3000); assert.equal(pano.pet.data.bubble.title, '千年古樟');
  pano.page.select(1); advance(5000); assert.equal(pano.pet.data.bubble, null); assert.equal(pano.pet._decision.why, 'dismissed');
  tap(pano); pano.pet.tapAction({ currentTarget: { dataset: { id: 'intro' } } }); advance(3000);
  assert.equal(pano.pet.data.bubble.title, '乌竹溪古水秤', 'a dismissed topic can still be replayed on request');
  // an introduction that was scheduled but never shown is delivered on return
  fresh();
  const again = openPage('pages/panorama/index', { id: '0' });
  advance(400); hidePage(again); assert.equal(timers.size, 0); advance(60000);
  showPage(again); assert.equal(again.pet._decision.why, 'pending-from-return'); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(again.pet.data.bubble.title, '千年古樟');
  // the greeting on the map tab is offered once per launch
  fresh();
  const map = openPage('pages/guide/index'); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(map.pet.data.bubble.title, '阿樟'); assert.equal(map.pet.data.bubble.source, '', 'a greeting carries no source line'); assert.equal(map.pet.data.pose, 'scroll');
  assert.equal(map.pet.data.bubble.tip, true, 'the first bubble of a launch carries the gesture hint');
  advance(pet.COOLDOWN_MS * 3); hidePage(map); showPage(map); advance(5000); assert.equal(map.pet.data.bubble, null);
  const village2 = (hidePage(map), openPage('pages/village/index')); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(village2.pet.data.bubble.title, '古渊头村'); assert.equal(village2.pet.data.bubble.tip, false, 'the hint is shown once per launch');
  assert(bubbleText(village2).includes('600多年') && bubbleText(village2).includes('巍山镇'), 'village overview, not a scenic point');
  assert.equal(storage[pet.STORE_KEY].hintCount, 1);
});

// ---- 6. long press from panorama and detail pages: same conversation, real context ------------
section('non-tab pages: long press opens the same conversation with the actual scenic context; closing restores title, page and position', () => {
  fresh();
  const tab = openPage('pages/village/index'); advance(20000);
  hold(tab); advance(6000); up(tab);
  tab.agent.ask({ currentTarget: { dataset: { question: '为什么被称为博士村？' } } }); advance(9000);
  tab.agent.close(); advance(520);
  assert.equal(session.state.messages.length, 2);
  hidePage(tab);
  store.collect(1);
  const pano = openPage('pages/panorama/index', { id: '1' }); advance(20000);
  pano.page.setData({ showTask: false, localPhoto: false });
  hold(pano);
  assert.equal(pano.agent.data.phase, 'receding'); assert.equal(pano.agent.data.short, true, 'repeat entries use the short opening');
  assert.deepEqual(session.state.context, { place: 1 }); assert.equal(pano.agent.data.contextName, '乌竹溪古水秤');
  assert.equal(pano.agent.data.sourceName, '线上寻樟 · 全景漫游');
  assert.equal(pano.page.data.guideMotion, 'guide-out'); assert.equal(pano.page.data.guideLock, 'overflow:hidden;');
  assert.equal(pano.pet.data.away, true);
  advance(2100); up(pano);
  assert.equal(pano.agent.data.phase, 'chat'); assert.equal(pano.pet.data.bubble, null);
  assert.equal(pano.agent.data.messages.length, 2, 'the conversation started on the tab is the one shown here');
  assert.equal(calls.title[calls.title.length - 1], '樟下问答');
  // "here" resolves to the scene the visitor is on
  pano.agent.input({ detail: { value: '这里是做什么用的？' } }); pano.agent.send(); advance(9000);
  let answer = session.state.messages[3];
  assert.equal(answer.status, 'done'); assert.deepEqual(answer.places, [1]); assert.equal(answer.card.id, 1); assert.equal(answer.context, 1);
  assert(/分水/.test(answer.text));
  // an explicit question about another place is not overridden by the page
  pano.agent.input({ detail: { value: '四本堂是什么地方？' } }); pano.agent.send(); advance(9000);
  answer = session.state.messages[5];
  assert.deepEqual(answer.places, [3]); assert.equal(answer.card.id, 3);
  // close: the page, its title and the companion are back
  const pos = { x: pano.pet.data.x, y: pano.pet.data.y };
  pano.agent.close(); advance(520);
  assert.equal(pano.agent.data.phase, 'idle'); assert.equal(pano.page.data.guideMotion, ''); assert.equal(pano.page.data.guideLock, '');
  assert.equal(calls.title[calls.title.length - 1], '线上寻樟 · 全景漫游', 'the real page title is restored');
  assert.equal(pano.pet.data.away, false); assert.deepEqual({ x: pano.pet.data.x, y: pano.pet.data.y }, pos); assert.equal(pano.page.data.scene.id, 1);
  // switch the scene, reopen: the context follows, the conversation stays
  pano.page.select(0); advance(20000);
  hold(pano); advance(2100); up(pano);
  assert.deepEqual(session.state.context, { place: 0 }); assert.equal(pano.agent.data.contextName, '千年古樟'); assert.equal(pano.agent.data.messages.length, 6);
  pano.agent.ask({ currentTarget: { dataset: { question: pano.agent.data.contextQuestion } } }); advance(9000);
  assert.equal(session.state.messages[7].card.id, 0);
  // hardware back closes the layer on a non-tab page too
  pano.agent.containerLeave(); assert.equal(pano.agent.data.phase, 'leaving'); advance(520); assert.equal(pano.pet.data.away, false);
  // a page opened from the open chat shows its own companion; the chat page keeps its state
  hold(pano); advance(2100); up(pano);
  pano.agent.openPlace({ currentTarget: { dataset: { id: 0 } } }); hidePage(pano);
  const place = openPage('pages/place/index', { id: '0' });
  assert.equal(place.pet.data.away, false, 'an open chat on the previous page does not hide this page\'s companion');
  assert.equal(calls.title.includes('千年古樟 · 景点介绍'), true);
  hold(place); advance(2100); up(place);
  assert.equal(place.agent.data.phase, 'chat'); assert.equal(place.agent.data.sourceName, '千年古樟 · 景点介绍'); assert.equal(place.agent.data.messages.length, 8);
  place.agent.close(); advance(520);
  assert.equal(calls.title[calls.title.length - 1], '千年古樟 · 景点介绍', 'runtime titles are restored exactly');
  closePage(place); showPage(pano);
  assert.equal(pano.agent.data.phase, 'chat'); assert.equal(pano.pet.data.away, true);
  pano.agent.close(); advance(520);
  // every other eligible page opens the same conversation with its own context
  const expectations = [['pages/place/index', { id: 'village' }, 'village'], ['pages/place/index', { id: '2' }, 2], ['pages/visit/index', { id: '3' }, 3], ['pages/cards/index', {}, 'village'], ['pages/gallery/index', { id: '1', index: '0' }, 1]];
  for (const [route, options, place2] of expectations) {
    hidePage(pano);
    const view = openPage(route, options); advance(20000);
    hold(view); advance(2100); up(view);
    assert.equal(view.agent.data.phase, 'chat', route); assert.deepEqual(session.state.context, { place: place2 }, route);
    assert.equal(view.agent.data.messages.length, 8, route + ' shows the shared conversation');
    assert.equal(view.agent.data.sourceName, entry.titleOf(view.page));
    view.agent.close(); advance(520); closePage(view); showPage(pano);
  }
  // the virtual route keeps the chat context on the selected stop without re-introducing itself
  hidePage(pano);
  assert.equal(pet.decideIntro({ topic: 'route' }, 'full', 'initial', Date.now()).why, 'cooldown', 'the route note was already given once in this launch (loop above)');
  pet.resetForTest(); // a new launch
  const visit = openPage('pages/visit/index', { id: 'village' }); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(visit.pet.data.bubble.title, '慢行路线'); assert(/虚拟演示/.test(bubbleText(visit)) && /真实导航/.test(bubbleText(visit)));
  visit.pet.closeBubble();
  visit.page.select({ currentTarget: { dataset: { id: 2 } } }); advance(5000);
  assert.equal(visit.pet.data.bubble, null); assert.deepEqual(pet.chatContext(visit.page), { place: 2 });
  assert.equal(calls.request.length, 0, 'demo mode: the whole flow made no network request');
});

// ---- 7. dragging and shared position -------------------------------------------------------
section('dragging: follows the finger inside safe bounds, snaps to a side, never taps or opens chat, survives navigation and resize', () => {
  fresh();
  const tab = openPage('pages/guide/index'); advance(30000);
  const pw = tab.pet.data.w, ph = tab.pet.data.h;
  assert.equal(tab.pet.data.side, 'right'); assert.equal(tab.pet.data.x, Math.round(390 - pw - 8));
  const reserve = 34 + 196 * 390 / 750; // safe area + tab bar clearance
  assert(tab.pet.data.y + ph <= 753 - reserve + 1, 'the default position clears the custom tab bar and the center button');
  const start = center(tab);
  down(tab, start.x, start.y); advance(100); move(tab, start.x - 5, start.y); assert.equal(tab.pet.data.dragging, false, 'inside 9 px: not yet a drag');
  move(tab, start.x - 60, start.y - 120); advance(20);
  assert.equal(tab.pet.data.dragging, true); assert.equal(tab.pet.data.pressing, false);
  move(tab, start.x - 150, start.y - 200);
  assert.equal(tab.pet.data.x, Math.round(390 - pw - 8) - 150); assert.equal(tab.pet.data.bubble, null);
  advance(3000); assert.equal(tab.agent.data.phase, 'idle', 'holding still during a drag is not a long press');
  // far beyond every edge: clamped
  move(tab, -500, -900); advance(20); move(tab, -501, -900);
  assert.equal(tab.pet.data.x, 8); assert.equal(tab.pet.data.y, 12);
  advance(20); move(tab, 900, 2000); advance(20); move(tab, 901, 2000);
  assert.equal(tab.pet.data.x, Math.round(390 - pw - 8)); assert(tab.pet.data.y + ph <= 753 - reserve + 1);
  advance(20); move(tab, start.x - 230, start.y - 300); advance(20);
  up(tab);
  assert.equal(tab.pet.data.dragging, false); assert.equal(tab.pet.data.side, 'left'); assert.equal(tab.pet.data.x, 8, 'release snaps to the nearer side');
  assert.equal(tab.pet.data.bubble, null, 'no tap reaction after a drag'); assert.equal(tab.agent.data.phase, 'idle'); assert.equal(tab.pet._opens, 0);
  assert.equal(storage[pet.STORE_KEY].side, 'left'); assert(storage[pet.STORE_KEY].y > 0 && storage[pet.STORE_KEY].y < 1);
  assert.deepEqual(Object.keys(storage).filter(k => k !== 'gengdu-yunjing-v1'), [pet.STORE_KEY], 'only the new namespaced key is written');
  const y = tab.pet.data.y;
  // another page: the same logical companion, the same place on screen
  hidePage(tab);
  const place = openPage('pages/place/index', { id: 'village' });
  assert.equal(place.pet.data.side, 'left'); assert.equal(place.pet.data.x, 8);
  assert(place.pet.data.y > y, 'the usable range is taller without the tab bar, the ratio is kept');
  assert.equal(pet.state.y, storage[pet.STORE_KEY].y);
  // touchcancel in the middle of a drag commits a valid position
  const c = center(place);
  down(place, c.x, c.y); move(place, c.x + 200, c.y + 30); place.pet.touchCancel();
  assert.equal(place.pet.data.dragging, false); assert.equal(place.pet.data.side, 'right'); assert.equal(place.pet._gesture.phase(), 'idle');
  // a smaller window: still reachable
  const tall = place.pet.data.y;
  WINDOW.windowHeight = 420; WINDOW.screenHeight = 511; WINDOW.safeArea.bottom = 477;
  petDef.pageLifetimes.resize.call(place.pet);
  assert(place.pet.data.y < tall && place.pet.data.y >= 12 && place.pet.data.y + place.pet.data.h <= 420 - 34);
  WINDOW.windowHeight = 753; WINDOW.screenHeight = 844; WINDOW.safeArea.bottom = 810;
  // a new launch restores the saved side and height
  const saved = JSON.parse(JSON.stringify(storage[pet.STORE_KEY]));
  closePage(place); pages = []; pet.resetForTest(); timers.clear();
  const relaunch = openPage('pages/village/index');
  assert.equal(relaunch.pet.data.side, saved.side); assert.equal(pet.state.y, saved.y);
  // the gallery keeps its zoom toolbar clear and uses the compact size
  hidePage(relaunch);
  const gallery = openPage('pages/gallery/index', { id: '0', index: '1' });
  assert.equal(gallery.pet.data.mode, 'compact'); assert(gallery.pet.data.w < relaunch.pet.data.w);
  assert(gallery.pet.data.y + gallery.pet.data.h <= 753 - 34 - 372 * 390 / 750 + 1, 'above the caption, zoom buttons and photo switcher');
  advance(20000); assert.equal(gallery.pet.data.bubble, null, 'quiet on the gallery'); assert.equal(gallery.pet._decision.why, 'quiet-page');
  tap(gallery); assert.equal(gallery.pet.data.bubble.kind, 'react');
});

// ---- 8. cleanup --------------------------------------------------------------------------------
section('cleanup: hide, unload, background and excluded routes leave no timer, bubble, pending gesture or request', () => {
  fresh();
  const pano = openPage('pages/panorama/index', { id: '0' });
  assert(pano.pet.pendingTimers().includes('intro') && pano.pet.pendingTimers().includes('sleep'));
  hidePage(pano); assert.equal(timers.size, 0, 'pending introduction cancelled on hide'); advance(60000); assert.equal(pano.pet.data.bubble, null);
  showPage(pano); advance(pet.INTRO_DELAY_MS + 200);
  assert(pano.pet.pendingTimers().includes('reveal'), 'text is being revealed');
  hidePage(pano); assert.equal(timers.size, 0); assert.equal(pano.pet.data.bubble, null, 'no stale bubble is kept for the return');
  showPage(pano); advance(1000);
  down(pano, 350, 500); advance(200); assert.equal(pano.pet._gesture.pending(), true);
  hidePage(pano); assert.equal(timers.size, 0); assert.equal(pano.pet._gesture.phase(), 'idle'); assert.equal(pano.pet.data.pressing, false);
  advance(5000); assert.equal(pano.agent.data.phase, 'idle', 'a hold interrupted by a route change opens nothing');
  up(pano); assert.equal(pano.pet.data.bubble, null, 'a late touchend is ignored');
  showPage(pano);
  hold(pano); advance(300); assert.equal(pano.agent.data.phase, 'receding');
  closePage(pano); assert.equal(timers.size, 0, 'unloading mid-opening leaves nothing behind');
  assert.equal(pano.page.__petHost, null);
  // commerce and personal pages
  for (const route of ['pages/shop/index', 'pages/profile/index', 'pages/product/index', 'pages/checkout/index']) {
    fresh();
    const tour = openPage('pages/village/index'); advance(300);
    hidePage(tour);
    const view = openPage(route, route.includes('product') ? { id: 'vegetable' } : {});
    assert.equal(view.pet, null, route + ' has no companion instance');
    assert.equal(timers.size, 0, route + ': no companion timer after leaving the tourism page');
    assert.equal(calls.request.length, 0);
  }
  // a companion placed on an excluded route by mistake renders nothing and binds nothing
  fresh();
  const stray = mountComponent(petDef); pages = [{ route: 'pages/shop/index', data: {} }];
  petDef.lifetimes.attached.call(stray); petDef.lifetimes.ready.call(stray); petDef.pageLifetimes.show.call(stray);
  assert.equal(stray.data.visible, false); assert.equal(timers.size, 0); assert.equal(pages[0].__petHost, undefined);
  // idle: after 75 s without interaction the companion dozes; a tap wakes it
  fresh();
  const tab = openPage('pages/village/index'); advance(20000);
  advance(75000); assert.equal(tab.pet.data.pose, 'sleep'); assert.equal(tab.pet.data.anim, 'doze');
  tap(tab); assert.equal(tab.pet.data.pose, 'greet'); assert(/醒/.test(bubbleText(tab)));
  // minimize and restore; minimized means no unsolicited speech; the state is shared and saved
  advance(5000); tap(tab); tab.pet.tapAction({ currentTarget: { dataset: { id: 'min' } } });
  assert.equal(tab.pet.data.minimized, true); assert.equal(tab.pet.data.bubble, null); assert.equal(storage[pet.STORE_KEY].minimized, true);
  assert(tab.pet.data.w < 50 && tab.pet.data.x + tab.pet.data.w === 390, 'a small tab flush with the edge');
  down(tab, 380, 500); advance(600); up(tab); assert.equal(tab.agent.data.phase, 'idle');
  hidePage(tab);
  const pano2 = openPage('pages/panorama/index', { id: '0' }); advance(5000);
  assert.equal(pano2.pet.data.minimized, true); assert.equal(pano2.pet.data.bubble, null); assert.equal(pano2.pet._decision.why, 'minimized');
  pano2.pet.restore();
  assert.equal(pano2.pet.data.minimized, false); assert.equal(pano2.pet.data.bubble.kind, 'react'); assert.equal(storage[pet.STORE_KEY].minimized, false);
  // collecting a postcard: one celebration on the postcard page
  advance(10000);
  pano2.page.setData({ showTask: true }); pano2.page.select(1); pano2.page.answer({ currentTarget: { dataset: { index: 1 } } });
  assert.deepEqual(calls.navigateTo.slice(-1), ['/pages/postcard/index?id=1']);
  hidePage(pano2);
  const card = openPage('pages/postcard/index', { id: '1' });
  assert.equal(card.pet.data.pose, 'celebrate'); assert.equal(card.pet.data.bubble.kind, 'celebrate'); assert.equal(card.pet.data.anim, 'jump');
  advance(3800); assert.equal(card.pet.data.bubble, null); assert.equal(card.pet.data.pose, 'read');
  hidePage(card); showPage(card); advance(3000); assert.equal(card.pet.data.bubble, null, 'the celebration is not repeated');
});

// ---- 9. knowledge grounding and API independence ---------------------------------------------
section('knowledge: introductions rest on the generated knowledge module, keep citations, and never pose as model output', () => {
  fresh();
  for (const topic of [0, 1, 2, 3, 'village', 'route']) {
    assert.equal(intros.supported(topic), true, 'introduction ' + topic + ' is no longer supported by utils/guide-knowledge.js: revise utils/pet-intros.js');
    const content = intros.get(topic);
    assert.equal(content.quoted, false); assert.equal(content.tag, '本地讲解资料');
    assert(content.text.length >= 50 && content.text.length <= 110, topic + ' length ' + content.text.length);
    assert(/^依据：/.test(content.source));
    for (const row of intros.raw[topic].ground) assert(knowledge.chunks.some(c => c.id === row.id), 'chunk ' + row.id);
    for (const id of intros.raw[topic].sources) { assert(knowledge.sources[id], 'source ' + id); assert(content.source.includes(prompt.sourceLabel(id))); }
    assert(!/AI 生成|模型生成(?!$)|在线讲解/.test(content.text + content.tag));
  }
  assert.equal(intros.get('greet').source, ''); assert.equal(intros.get('greet').tag, '');
  assert.equal(intros.get(0).title, places[0].name); assert.equal(intros.get(3).title, places[3].name); assert.equal(intros.get('village').title, village.name);
  assert.equal(intros.get(9), null);
  const markup = read('components/village-pet/index.wxml');
  assert(markup.includes('{{bubble.source}} · 非模型生成'), 'sourced text is labeled as not model-generated');
  // if a rebuilt knowledge base drops a fact, the prepared text is not shown; the excerpt comes from retrieval
  const chunk = knowledge.chunks.find(c => c.id === 'K6-2');
  const original = chunk.text;
  chunk.text = original.replace('1220年', '若干年');
  assert.equal(intros.supported(0), false);
  const fallback = intros.get(0);
  assert.equal(fallback.quoted, true); assert(!fallback.text.includes('1220年')); assert(/古樟/.test(fallback.text)); assert.equal(fallback.source, '依据：知识库原文摘录');
  chunk.text = original; assert.equal(intros.get(0).quoted, false);
  // retrieval with page context
  const here = retrieval.retrieve('这里有什么故事？', [], { contextPlace: 0 });
  assert.deepEqual(here.places, [0]); assert.equal(here.usesPlaceContext, true); assert.equal(here.primaryPlace, 0);
  assert(here.chunks.some(c => c.places.includes(0)));
  const explicit = retrieval.retrieve('四本堂是什么地方？', [], { contextPlace: 0 });
  assert.deepEqual(explicit.places, [3]); assert.equal(explicit.usesPlaceContext, false);
  const aboutVillage = retrieval.retrieve('古渊头村有多少年历史？', [], { contextPlace: 1 });
  assert.equal(aboutVillage.primaryPlace, 'village'); assert.deepEqual(aboutVillage.places, []);
  const history = [{ question: '古水秤是做什么用的？', places: [1] }];
  const follow = retrieval.retrieve('那它为什么能讲公平呢？', history, { contextPlace: 0 });
  assert.equal(follow.usesContext, true); assert.deepEqual(follow.places, [1], 'a pronoun follows the conversation, not the page');
  const moved = retrieval.retrieve('这里是什么地方？', history, { contextPlace: 2 });
  assert.deepEqual(moved.places, [2], '"here" follows the page the visitor is on');
  const villageHere = retrieval.retrieve('这里有什么好看的？', [], { contextPlace: 'village' });
  assert.equal(villageHere.primaryPlace, 'village');
  assert.deepEqual(retrieval.retrieve('门票多少钱？', [], { contextPlace: 0 }).live, ['门票与收费']);
  assert.equal(retrieval.retrieve('门票多少钱？', [], { contextPlace: 0 }).usesPlaceContext, false, 'real-time questions are not bent toward a scenic point');
  // without a context nothing changes for the existing chat
  const plain = retrieval.retrieve('千年古樟有什么故事？', []);
  assert.deepEqual(retrieval.retrieve('千年古樟有什么故事？', [], {}).chunks.map(c => c.id), plain.chunks.map(c => c.id));
  assert.equal(prompt.buildMessages('q', plain, []).pop().content, prompt.buildMessages('q', plain, [], null).pop().content);
  const noted = prompt.buildMessages('这里有什么故事？', here, [], 0).pop().content;
  assert(noted.includes('【游客当前所在页面】千年古樟') && noted.includes('以游客的问题为准'));
  assert(noted.indexOf('【游客当前所在页面】') < noted.indexOf('【游客提问】') && noted.indexOf('<资料') < noted.indexOf('【游客当前所在页面】'));
  assert(!prompt.buildMessages('q', plain, []).pop().content.includes('当前所在页面'));
  assert(prompt.buildMessages('这里有什么故事？', here, [], 0).map(m => m.content).join('\n').length < 5200, 'the prompt stays small');
  // live mode: the page context travels with the request; a provider failure leaves the companion working
  config.setForTest({ mode: 'live-direct', apiKey: 'sk-test' });
  const seen = [];
  session.setTransportForTest(options => { seen.push(options); const task = { abort() { options.fail({ errMsg: 'request:fail abort' }); }, onChunkReceived() {} };
    setTimeout(() => options.success({ statusCode: 403, data: JSON.stringify({ error: { message: 'quota', code: 'insufficient_user_quota' } }) }), 200); return task; });
  const pano = openPage('pages/panorama/index', { id: '0' });
  advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(pano.pet.data.bubble.title, '千年古樟'); assert.equal(seen.length, 0, 'the introduction made no request even in live mode');
  hold(pano); advance(6000); up(pano);
  pano.agent.input({ detail: { value: '这里有什么故事？' } }); pano.agent.send(); advance(400);
  assert.equal(seen.length, 1);
  const sent = seen[0].data.messages;
  assert.equal(seen[0].data.model, 'agent/qwen3-coder-30b-a3b-instruct(free)');
  assert(sent[sent.length - 1].content.includes('【游客当前所在页面】千年古樟') && /<资料 出处=/.test(sent[sent.length - 1].content));
  assert(!JSON.stringify(sent).includes('sk-test'));
  assert.equal(session.state.messages[1].status, 'error'); assert.equal(session.state.messages[1].error.kind, 'quota');
  pano.agent.close(); advance(520);
  tap(pano); assert.equal(pano.pet.data.bubble.kind, 'react', 'reactions work after an API failure');
  pano.pet.tapAction({ currentTarget: { dataset: { id: 'intro' } } }); advance(3000);
  assert.equal(bubbleText(pano), intros.get(0).text); assert.equal(seen.length, 1);
  session.setTransportForTest(null); config.setForTest({ mode: 'demo' });
});

// ---- 10. asset ---------------------------------------------------------------------------------------
section('asset: the runtime sheet is the 4 x 3 cut-out of the supplied character, transparent, with recorded provenance', () => {
  const png = fs.readFileSync('assets/pet/azhang-poses.png');
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 912);
  assert.equal(png[25], 6, 'colour type 6: RGBA with an alpha channel');
  const report = JSON.parse(read('docs/companion/poses/cutout-report.json'));
  assert.deepEqual(report.sourceSize, [1318, 758]); assert.deepEqual(report.cell, [256, 304]);
  const order = ['greet', 'cheer', 'think', 'read', 'scroll', 'walk', 'point', 'fish', 'approve', 'shy', 'sleep', 'celebrate'];
  assert.deepEqual(report.poses.map(p => p.pose), order);
  const component = read('components/village-pet/index.js');
  assert(component.includes("const POSES = ['" + order.join("', '") + "'];"), 'the component reads the cells in the order the build script writes them');
  const crypto = require('node:crypto');
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(sha('docs/companion/character-reference.jpg'), report.sourceSha256, 'cut from the reference kept in docs/companion');
  const original = path.resolve(root, '..', 'Claude_Pet_Handoff', 'reference', 'character-reference.jpg');
  if (fs.existsSync(original)) assert.equal(sha(original), report.sourceSha256, 'which is the user\'s original, byte for byte');
  for (const pose of report.poses) {
    assert.equal(sha('docs/companion/poses/' + pose.file), pose.sha256);
    const [l, t, r, b] = pose.sourceBox;
    assert(t >= 14 && (b <= 306 || (t >= 398 && b <= 678)), pose.pose + ': the crop stops above the caption plate');
    assert(l >= 0 && r <= 1272);
  }
});

// ---- 11. back catcher: one page-container in the whole app, owned by the open layer ----------
section('back catcher: no page-container while idle, exactly one while a layer is open, handed over across cached tabs and pushed pages', () => {
  fresh();
  const markupFiles = ['components/guide-agent/index.wxml', 'components/village-pet/index.wxml', 'custom-tab-bar/index.wxml', ...JSON.parse(read('app.json')).pages.map(p => p + '.wxml')];
  assert.deepEqual(markupFiles.filter(f => /<page-container/.test(read(f))), ['components/guide-agent/index.wxml'], 'the only page-container in the project is the guide layer\'s');
  assert.equal((read('components/guide-agent/index.wxml').match(/<page-container/g) || []).length, 1);
  assert(/<page-container wx:if="\{\{backCapture && containerMounted\}\}"/.test(read('components/guide-agent/index.wxml')));
  assert.equal(agentDef.data.containerMounted, false);
  // four cached tabs and two pushed tourism pages, all idle: nothing is mounted
  const tabs = TABS.map(route => { const view = openPage(route); hidePage(view); return view; });
  const village = tabs[1];
  pages = [village.page]; showPage(village); advance(30000);
  assert.equal(allAgents.length, 4); assert.equal(catchers(), 0, 'idle guide layers on cached tabs create no page-container');
  assert.equal(backOwner.owner(), null);
  // open on one tab: one catcher, mounted hidden, shown one update later
  village.bar.openGuide();
  assert.equal(catchers(), 1); assert.equal(backOwner.owner(), village.agent);
  assert.equal(village.agent.data.containerMounted, true); assert.equal(village.agent.data.containerShown, false, 'never created and shown in the same update');
  advance(80); assert.equal(village.agent.data.containerShown, true);
  // skipping the intro does not disturb it
  village.agent.skip(); advance(900); assert.equal(village.agent.data.phase, 'chat'); assert.equal(village.agent.data.containerShown, true); assert.equal(catchers(), 1);
  // source sheet: first back closes the sheet, the catcher stays mounted and is re-armed after 320 ms
  village.agent.ask({ currentTarget: { dataset: { question: '千年古樟多少岁了？' } } }); advance(9000);
  village.agent.tapCite({ currentTarget: { dataset: { id: 'S05' } } });
  village.agent.containerLeave(); village.agent.containerLeave(); village.agent.containerLeave();
  assert.equal(village.agent.data.source, null); assert.equal(village.agent.data.phase, 'chat');
  assert.equal(village.agent.data.containerMounted, true); assert.equal(village.agent.data.containerShown, false); assert.equal(catchers(), 1);
  advance(320); assert.equal(village.agent.data.containerShown, true);
  // next back closes the layer; the catcher is unmounted once the exit has finished
  village.agent.containerLeave(); assert.equal(village.agent.data.phase, 'leaving'); assert.equal(village.agent.data.containerShown, false);
  assert.equal(village.agent.data.containerMounted, true, 'kept through its own leave transition');
  advance(520); assert.equal(village.agent.data.phase, 'idle'); assert.equal(catchers(), 0); assert.equal(backOwner.owner(), null); assert.equal(timers.size - village.pet.pendingTimers().length, 0);
  // a chat left open on a page that gets hidden gives the catcher up; the pushed page can use it
  village.bar.openGuide(); advance(3000); assert.equal(village.agent.data.phase, 'chat');
  village.agent.openPlace({ currentTarget: { dataset: { id: 0 } } }); village.agent.containerLeave();
  hidePage(village);
  assert.equal(village.agent.data.phase, 'chat', 'the conversation stays open behind'); assert.equal(catchers(), 0, 'a hidden page holds no page-container'); assert.equal(backOwner.owner(), null);
  const place = openPage('pages/place/index', { id: '0' }); advance(20000);
  assert.equal(catchers(), 0);
  hold(place); assert.equal(catchers(), 1); assert.equal(backOwner.owner(), place.agent); advance(2100); up(place);
  assert.equal(place.agent.data.containerShown, true); assert.equal(village.agent.data.containerMounted, false);
  place.agent.containerLeave(); advance(520); assert.equal(place.agent.data.phase, 'idle'); assert.equal(catchers(), 0);
  // returning to the tab re-mounts and re-arms its catcher; back then closes that chat
  closePage(place); showPage(village);
  assert.equal(village.agent.data.containerMounted, true); assert.equal(village.agent.data.containerShown, false); assert.equal(catchers(), 1);
  advance(80); assert.equal(village.agent.data.containerShown, true);
  village.agent.containerLeave(); advance(520); assert.equal(village.agent.data.phase, 'idle'); assert.equal(catchers(), 0);
  // background and resume in the middle of the intro
  village.bar.openGuide(); advance(300); hidePage(village);
  assert.equal(village.agent.data.phase, 'chat'); assert.equal(catchers(), 0); assert.equal(timers.size, 0, 'no arm timer survives the hide');
  appShow(); showPage(village); assert.equal(catchers(), 1); advance(80); assert.equal(village.agent.data.containerShown, true);
  // a back press that arrives while the page is hidden is not taken as "close"
  hidePage(village); village.agent.containerLeave(); assert.equal(village.agent.data.phase, 'chat'); showPage(village); advance(80);
  // if a hide was never delivered, opening another layer still leaves exactly one catcher
  pages = [village.page];
  const pano = openPage('pages/panorama/index', { id: '0' }); advance(20000);
  assert.equal(village.agent.data.containerMounted, true, 'precondition: the tab layer still holds it');
  hold(pano); advance(700); up(pano);
  assert.equal(catchers(), 1); assert.equal(backOwner.owner(), pano.agent); assert.equal(village.agent.data.containerMounted, false, 'the previous owner unmounted when the token moved');
  advance(60000); assert.equal(catchers(), 1, 'a stale arm timer cannot bring a second one back');
  // unloading the page with its layer open frees the token
  closePage(pano); assert.equal(backOwner.owner(), null);
  showPage(village); assert.equal(catchers(), 1); advance(80);
  village.agent.close(); advance(520); assert.equal(catchers(), 0);
  // repeated opens and closes never accumulate
  for (let i = 0; i < 6; i++) { village.bar.openGuide(); assert.equal(catchers(), 1); advance(i % 2 ? 40 : 2500); village.agent.close(); advance(520); assert.equal(catchers(), 0); }
  // back capture switched off: nothing is ever mounted, the layer still opens and closes
  fresh(); config.setForTest({ mode: 'demo', backCapture: false });
  const off = openPage('pages/panorama/index', { id: '0' }); advance(20000);
  hold(off); advance(6000); up(off); assert.equal(off.agent.data.phase, 'chat'); assert.equal(catchers(), 0); assert.equal(backOwner.owner(), null);
  off.agent.close(); advance(520); assert.equal(off.agent.data.phase, 'idle');
});

// ---- 12. overlay host and layer order ---------------------------------------------------------------
section('layering: companion rendered at the page root above all page content, below tab bar and chat; page sheets hide it explicitly', () => {
  fresh();
  const css = read('components/village-pet/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootRule = css.match(/\.vp \{([^}]*)\}/)[1];
  const zOf = text => Number((/z-index:\s*(\d+)/.exec(text) || [])[1]);
  const petZ = zOf(rootRule);
  assert.equal(petZ, 700);
  assert(/position:\s*fixed/.test(rootRule) && /transform:\s*translate3d\(0, 0, 0\)/.test(rootRule) && /will-change:\s*transform/.test(rootRule), 'the companion always has a compositing layer of its own');
  assert(/\.vp-away \{[^}]*translate3d\(0, 0, 0\)[^}]*pointer-events:\s*none/.test(css), 'the hidden state keeps the layer and takes no touches');
  assert(/@keyframes vp-enter \{[^@]*translate3d/.test(css));
  // nothing a page can draw outranks it
  const pageSheets = ['app.wxss', 'components/scene-art/index.wxss', ...JSON.parse(read('app.json')).pages.map(p => p + '.wxss')];
  let highest = 0;
  for (const file of pageSheets) for (const m of read(file).matchAll(/z-index\s*:\s*(-?\d+)/g)) highest = Math.max(highest, Number(m[1]));
  assert.equal(highest, 50, 'highest page-level z-index is the sheet mask');
  assert(petZ > highest);
  const barZ = zOf(read('custom-tab-bar/index.wxss').match(/\.tb \{[^}]*\}/)[0]), layerZ = zOf(read('components/guide-agent/index.wxss').match(/\.g-layer \{[^}]*\}/)[0]);
  assert(petZ < barZ && barZ < layerZ, 'companion < tab bar < guide layer');
  // overlay host: the character and its bubble are inside root-portal, the guide layer is not
  const markup = read('components/village-pet/index.wxml').replace(/<!--[\s\S]*?-->/g, '').trim();
  assert(/^<root-portal enable="\{\{portal && !docked\}\}">\s*<view wx:if="\{\{visible\}\}" class="vp /.test(markup));
  const inside = markup.slice(0, markup.indexOf('</root-portal>'));
  assert(inside.includes('class="vp-bubble') && inside.includes('class="vp-body') && inside.includes('class="vp-tab"'), 'bubble, character and minimized tab are all in the overlay host');
  assert(!inside.includes('<guide-agent') && /<guide-agent wx:if="\{\{hostGuide\}\}" id="pet-guide"/.test(markup), 'the hosted guide layer stays outside the portal');
  assert.equal((markup.match(/<root-portal/g) || []).length, 1);
  assert(markup.includes("{{away || covered ? 'vp-away' : ''}}") && markup.includes('bubble && !minimized && !away && !covered'));
  const panoMarkup = wxmlOf('pages/panorama/index');
  assert(/class="stage-hint"[^\n]*\n <\/view>\s*<village-pet id="pet" covered="\{\{showTask\}\}" docked="\{\{true\}\}"\/>/.test(panoMarkup), 'the dock follows the panorama stage in page flow');
  assert(/\.vp-docked \{[^}]*position:\s*relative/.test(css), 'the panorama dock scrolls with the page');
  assert(panoMarkup.includes('hidden="{{showTask || guideMotion !== \'\'}}"'), 'opaque dialogs hide the native surface without removing the renderer');
  wx.canIUse = name => name === 'root-portal';
  assert.equal(pet.overlayPortal(), true);
  wx.canIUse = () => false; assert.equal(pet.overlayPortal(), false, 'older base library: rendered in place');
  delete wx.canIUse; assert.equal(pet.overlayPortal(), true);
  // every eligible page that has a sheet tells the companion; pages without one pass nothing
  for (const route of Object.keys(pet.ROUTES)) {
    const page = wxmlOf(route);
    const sheet = /<view wx:if="\{\{(\w+)\}\}" class="sheet-mask"/.exec(page);
    const bound = /<village-pet id="pet"(?: covered="\{\{(\w+)\}\}")?(?: docked="\{\{true\}\}")?\/>/.exec(page);
    assert(bound, route);
    assert.equal(bound[1], sheet ? sheet[1] : undefined, route + ': covered must be bound to the page\'s sheet flag');
  }
  assert.equal(petDef.properties.covered.type, Boolean); assert.equal(petDef.properties.covered.observer, 'coverChanged');
  // behaviour: a task sheet opened before the introduction appears
  const pano = openPage('pages/panorama/index', { id: '0' });
  assert.equal(pano.pet.data.docked, true);
  down(pano, 350, 500); move(pano, 320, 100); up(pano);
  assert.equal(pano.pet.data.dragging, false, 'the panorama companion stays in its dock');
  assert.equal(pet.state.y, 0.66, 'dragging at the dock preserves the saved floating position');
  advance(300); cover(pano, true);
  assert.equal(timers.size, 0, 'nothing keeps running under a sheet'); advance(5000); assert.equal(pano.pet.data.bubble, null);
  hold(pano); advance(2000); up(pano); assert.equal(pano.agent.data.phase, 'idle', 'a hidden companion takes no gesture'); assert.equal(pano.pet.data.bubble, null);
  cover(pano, false);
  assert.equal(pano.pet._decision.why, 'pending-from-return'); advance(pet.INTRO_DELAY_MS + 3000);
  assert.equal(pano.pet.data.bubble.title, '千年古樟', 'the cut-off introduction is delivered when the sheet closes');
  // a sheet opened while a bubble is showing and a press is in progress
  down(pano, 350, 500); advance(100); cover(pano, true);
  assert.equal(pano.pet.data.bubble, null); assert.equal(pano.pet.data.pressing, false); assert.equal(pano.pet._gesture.phase(), 'idle'); assert.equal(timers.size, 0);
  advance(3000); up(pano); assert.equal(pano.agent.data.phase, 'idle'); assert.equal(pano.pet.data.bubble, null);
  cover(pano, false); advance(5000); assert.equal(pano.pet.data.bubble, null, 'no repeat after the sheet closes (cooldown)');
  tap(pano); assert.equal(pano.pet.data.bubble.kind, 'react', 'interactive again');
  // an introduction cut off by the chat (centre button pressed at once) is delivered after the chat closes
  fresh();
  const tab = openPage('pages/village/index'); advance(200);
  tab.bar.openGuide(); advance(6000); assert.equal(tab.pet.data.bubble, null); assert.equal(tab.pet.data.away, true);
  tab.agent.close(); advance(520 + pet.INTRO_DELAY_MS + 3000);
  assert.equal(tab.pet.data.bubble.title, '古渊头村');
});

Date.now = realNow;
console.log('PASS: ' + results.length + ' companion check groups (logic only; no rendering, no WeChat runtime).');
