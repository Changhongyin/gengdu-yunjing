// Logic checks for the guide entry, cinematic state machine, chat states,
// provider adapter and knowledge grounding. Pure Node: it mocks wx, Page and
// Component, and uses a virtual clock. It does not render anything and is not
// a substitute for WeChat DevTools or a device.
// Usage (from work/): node scripts/check-guide.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
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
const calls = { switchTab: [], navigateTo: [], request: [], title: [], hideKeyboard: 0 };
const storage = {};
global.wx = {
  switchTab: o => calls.switchTab.push(o.url), navigateTo: o => calls.navigateTo.push(o.url),
  setNavigationBarTitle: o => calls.title.push(o.title), hideKeyboard: () => { calls.hideKeyboard++; },
  getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; },
  showToast() {}, showModal() {}, pageScrollTo() {},
  request: o => { calls.request.push(o); return { abort() {}, onChunkReceived() {} }; }
};
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
const routes = ['pages/guide/index', 'pages/village/index', 'pages/shop/index', 'pages/profile/index'];
let pages = [];
global.getCurrentPages = () => pages;
function makeTab(index) {
  const agent = mountComponent(agentDef);
  const bar = mountComponent(barDef, { '#guide': agent });
  agent.listeners.phase = [e => bar.onPhase(e)];
  const def = load('../' + routes[index] + '.js');
  const page = { route: routes[index], data: JSON.parse(JSON.stringify(def.data)), motions: [],
    setData(patch) { if ('guideMotion' in patch) this.motions.push(patch.guideMotion); applyData(this.data, patch); },
    getTabBar: () => bar };
  for (const [name, fn] of Object.entries(def)) if (typeof fn === 'function') page[name] = fn.bind(page);
  pages = [page];
  agentDef.lifetimes.attached.call(agent);
  barDef.lifetimes.attached.call(bar);
  return { agent, bar, page };
}
const session = require('../utils/guide-session');
const config = require('../utils/guide-config');
const provider = require('../utils/guide-provider');
const retrieval = require('../utils/guide-retrieval');
const prompt = require('../utils/guide-prompt');
const format = require('../utils/guide-format');
const knowledge = require('../utils/guide-knowledge');
const { places, village } = require('../utils/places');
const fresh = () => { session.reset(); session.state.introPlayed = false; timers.clear(); config.setForTest({ mode: 'demo' }); calls.request.length = 0; };
const TITLE = '古村问地';

// ---- 1. navigation integration ----------------------------------------------
section('navigation: custom tab bar keeps the four destinations and adds a non-destination center action', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.tabBar.custom, true);
  assert.deepEqual(app.tabBar.list.map(x => x.pagePath), routes);
  const baseline = path.join(require('./lib/project-paths.cjs').baseline, 'app.json');
  if (fs.existsSync(baseline)) {
    const before = JSON.parse(read(baseline));
    assert.deepEqual(app.tabBar.list, before.tabBar.list, 'tab list must equal the baseline');
    assert.deepEqual(app.pages, before.pages, 'page registrations must equal the baseline (the guide adds no route)');
  }
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    assert(fs.existsSync('custom-tab-bar/index.' + ext));
    assert(fs.existsSync('components/guide-agent/index.' + ext));
  }
  assert.deepEqual(barDef.data.tabs.map(t => t.path), routes);
  assert.deepEqual(barDef.data.tabs.map(t => t.text), app.tabBar.list.map(t => t.text));
  const barMarkup = read('custom-tab-bar/index.wxml');
  assert.equal((barMarkup.match(/bindtap="switchTab"/g) || []).length, 4);
  assert.equal((barMarkup.match(/bindtap="openGuide"/g) || []).length, 1);
  assert(barMarkup.indexOf('data-index="1"') < barMarkup.indexOf('openGuide') && barMarkup.indexOf('openGuide') < barMarkup.indexOf('data-index="2"'), 'center action sits between village and shop');
  for (let i = 0; i < 4; i++) {
    fresh();
    const { bar, page } = makeTab(i);
    assert.equal(bar.data.selected, i, 'attached() selects the current route');
    bar.setData({ selected: (i + 1) % 4 });
    page.onShow();
    assert.equal(bar.data.selected, i, 'onShow restores the active tab on ' + routes[i]);
    calls.switchTab.length = 0;
    bar.switchTab({ currentTarget: { dataset: { index: i } } });
    assert.equal(calls.switchTab.length, 0, 'tapping the active tab does nothing');
    const other = (i + 2) % 4;
    bar.switchTab({ currentTarget: { dataset: { index: other } } });
    assert.deepEqual(calls.switchTab, ['/' + routes[other]]);
    const markup = read(routes[i] + '.wxml');
    assert(/^<page-meta page-style="\{\{guideLock\}\}"\/>\r?\n<view class="page[^"]*\{\{guideMotion\}\}">/.test(markup), 'page-meta is the first node and the root view binds guideMotion on ' + routes[i]);
    assert.equal((markup.match(/<page-meta/g) || []).length, 1);
    assert.equal(page.data.guideMotion, ''); assert.equal(page.data.guideLock, '');
    // Custom tab bar rule from the platform documentation: every tab page declares usingComponents.
    assert(JSON.parse(read(routes[i] + '.json')).usingComponents, routes[i] + '.json must declare usingComponents (required for getTabBar with a custom tab bar)');
  }
  calls.switchTab.length = 0; calls.navigateTo.length = 0;
  fresh();
  const { bar } = makeTab(1);
  bar.openGuide();
  assert.equal(calls.switchTab.length + calls.navigateTo.length, 0, 'the center action never navigates');
  bar.switchTab({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(calls.switchTab.length, 0, 'tabs are locked while the guide layer is open');
});

// ---- 2. entry timeline, repeated taps, input without network -----------------
section('entry: repeated taps are ignored; phases run 700 / 3400 / 900 ms; chat is usable without any request', () => {
  fresh();
  const { agent, bar, page } = makeTab(1);
  assert.equal(bar.openGuide(), undefined);
  assert.equal(agent.data.phase, 'receding');
  assert.deepEqual(page.motions, ['guide-out']);
  assert.equal(page.data.guideLock, 'overflow:hidden;', 'the page behind is locked while the layer is open');
  // 2026-11-17 native fix: the back catcher is mounted hidden at open and shown one update later (80 ms),
  // instead of being pre-mounted on every idle instance (platform: only one page-container may exist).
  assert.equal(agent.data.backCapture, true); assert.equal(agent.data.containerMounted, true); assert.equal(agent.data.containerShown, false);
  assert.equal(bar.data.sunk, true);
  const pending = timers.size;
  for (let i = 0; i < 5; i++) assert.equal(agent.open(), false, 'second tap must be ignored');
  assert.equal(timers.size, pending, 'repeated taps must not add timers');
  assert.equal(agent.data.chatMounted, false);
  advance(79); assert.equal(agent.data.containerShown, false); advance(1); assert.equal(agent.data.containerShown, true, 'armed 80 ms after mounting');
  advance(619); assert.equal(agent.data.phase, 'receding');
  advance(1); assert.equal(agent.data.phase, 'cinema');
  advance(3399); assert.equal(agent.data.phase, 'cinema');
  advance(1); assert.equal(agent.data.phase, 'reveal'); assert.equal(agent.data.chatMounted, true);
  advance(899); assert.equal(agent.data.phase, 'reveal');
  advance(1); assert.equal(agent.data.phase, 'chat');
  const marks = agent.timeline();
  assert.equal(marks.cinema - marks.tap, 700);
  assert.equal(marks.reveal - marks.cinema, 3400);
  assert.equal(marks.chat - marks.reveal, 900);
  assert.equal(calls.request.length, 0, 'the intro must not depend on the network');
  agent.input({ detail: { value: '古樟' } });
  assert.equal(agent.data.canSend, true);
  assert.equal(calls.title[calls.title.length - 1], '樟下问答', 'the native bar gets a companion title while the layer shows the product title');
  advance(20000); assert.equal(agent.data.phase, 'chat', 'the cinematic never replays by itself');
});

// ---- 3. skip, cancel, back, background -------------------------------------
section('transition control: skip, back during the intro, back in chat, background and resume, no stuck layer', () => {
  fresh();
  let tab = makeTab(0);
  tab.agent.open(); advance(300);
  tab.agent.skip();
  assert.equal(tab.agent.data.phase, 'reveal'); assert.equal(tab.agent.data.skipped, true);
  advance(900); assert.equal(tab.agent.data.phase, 'chat');
  tab.agent.skip(); assert.equal(tab.agent.data.phase, 'chat', 'skip outside the intro does nothing');

  fresh(); tab = makeTab(2);
  tab.agent.open(); advance(1800);
  assert.equal(tab.page.data.guideLock, 'overflow:hidden;');
  assert.equal(tab.agent.close(), true);
  assert.equal(tab.agent.data.phase, 'leaving');
  assert.equal(tab.page.data.guideLock, '', 'the page is unlocked as soon as the layer starts to leave');
  assert.equal(tab.agent.close(), false, 'double close is ignored');
  assert.equal(tab.agent.open(), false, 'cannot re-enter while leaving');
  advance(519); assert.equal(tab.agent.data.phase, 'leaving');
  advance(1); assert.equal(tab.agent.data.phase, 'idle');
  assert.deepEqual(tab.page.motions, ['guide-out', 'guide-in', '']);
  assert.equal(tab.bar.data.sunk, false);
  advance(20000); assert.equal(tab.agent.data.phase, 'idle', 'cancelled timers must not fire later');
  assert.equal(calls.title[calls.title.length - 1], '乡味好物', 'navigation title is restored');
  assert.equal(timers.size, 0, 'no timers left after returning');

  // hardware / gesture back through the page-container
  fresh(); tab = makeTab(3);
  tab.agent.open(); advance(5000);
  assert.equal(tab.agent.data.containerShown, true);
  tab.agent.containerLeave();
  assert.equal(tab.agent.data.phase, 'leaving');
  advance(520); assert.equal(tab.agent.data.phase, 'idle');
  tab.agent.containerLeave(); assert.equal(tab.agent.data.phase, 'idle');
  // one back press delivers up to three container events; only the first acts
  fresh(); tab = makeTab(3);
  tab.agent.open(); advance(5000);
  tab.agent.ask({ currentTarget: { dataset: { question: '千年古樟多少岁了？' } } }); advance(9000);
  tab.agent.tapCite({ currentTarget: { dataset: { id: 'S05' } } });
  assert(tab.agent.data.source, 'source sheet is open');
  tab.agent.containerLeave(); tab.agent.containerLeave(); tab.agent.containerLeave();
  assert.equal(tab.agent.data.source, null, 'the first back closes the source sheet');
  assert.equal(tab.agent.data.phase, 'chat', 'and keeps the chat open');
  assert.equal(tab.agent.data.containerShown, false);
  advance(319); assert.equal(tab.agent.data.containerShown, false);
  advance(1); assert.equal(tab.agent.data.containerShown, true, 'the back catcher is re-armed after its leave transition');
  tab.agent.containerLeave(); tab.agent.containerLeave(); tab.agent.containerLeave();
  assert.equal(tab.agent.data.phase, 'leaving', 'the next back closes the guide');
  advance(520); assert.equal(tab.agent.data.phase, 'idle'); assert.equal(timers.size, 0);
  // a container closing that arrives before onHide while opening a linked page is not "back"
  fresh(); tab = makeTab(1);
  tab.agent.open(); advance(5000);
  calls.navigateTo.length = 0;
  tab.agent.openPlace({ currentTarget: { dataset: { id: 1 } } });
  tab.agent.openPlace({ currentTarget: { dataset: { id: 1 } } });
  assert.deepEqual(calls.navigateTo, ['/pages/place/index?id=1'], 'a double tap opens one page');
  tab.agent.containerLeave();
  assert.equal(tab.agent.data.phase, 'chat', 'navigating away keeps the chat');
  tab.page.onHide(); tab.page.onShow();
  assert.equal(tab.agent.data.containerShown, false); advance(320); assert.equal(tab.agent.data.containerShown, true);
  tab.agent.containerLeave(); assert.equal(tab.agent.data.phase, 'leaving'); advance(520);
  // backCapture can be switched off; the layer still opens and closes
  fresh(); config.setForTest({ mode: 'demo', backCapture: false }); tab = makeTab(2);
  assert.equal(tab.agent.data.backCapture, false);
  tab.agent.open(); advance(5000); assert.equal(tab.agent.data.phase, 'chat');
  tab.agent.close(); advance(520); assert.equal(tab.agent.data.phase, 'idle');
  // lockPageScroll can be switched off
  fresh(); config.setForTest({ mode: 'demo', lockPageScroll: false }); tab = makeTab(2);
  tab.agent.open(); assert.equal(tab.page.data.guideLock, ''); tab.agent.close(); advance(520);

  // background during the cinematic resolves to a stable chat, not a half-played intro
  fresh(); tab = makeTab(1);
  tab.agent.open(); advance(2000);
  tab.page.onHide();
  assert.equal(tab.agent.data.phase, 'chat'); assert.equal(timers.size, 0);
  tab.page.onShow(); advance(10000);
  assert.equal(tab.agent.data.phase, 'chat');
  // leaving for a linked page must not be treated as "back"
  tab.page.onHide(); tab.agent.containerLeave(); assert.equal(tab.agent.data.phase, 'chat');
  tab.page.onShow(); advance(320); assert.equal(tab.agent.data.containerShown, true);
  // background while leaving resolves to the page
  tab.agent.close(); advance(100); tab.page.onHide();
  assert.equal(tab.agent.data.phase, 'idle'); assert.equal(tab.page.data.guideMotion, '');
  // detaching the component clears everything
  tab.page.onShow(); tab.agent.open(); advance(100);
  agentDef.lifetimes.detached.call(tab.agent);
  assert.equal(timers.size, 0);
  // an idle instance on another tab must not interrupt the open one when it is destroyed
  fresh(); tab = makeTab(1);
  const idle = mountComponent(agentDef);
  tab.agent.open(); advance(5000);
  tab.agent.ask({ currentTarget: { dataset: { question: '讲讲村子的概况' } } }); advance(600);
  agentDef.lifetimes.detached.call(idle);
  assert.equal(session.state.busy, true, 'the answer keeps streaming');
  advance(9000); assert.equal(tab.agent.data.messages[1].status, 'done');
  // returning to a page whose layer stayed open resyncs with the shared conversation
  tab.page.onHide();
  session.subscribe(() => {}); // another tab's layer takes the single listener slot
  session.send('为什么被称为博士村？'); advance(9000);
  assert.equal(tab.agent.data.messages.length, 2, 'hidden page did not change');
  tab.page.onShow();
  assert.equal(tab.agent.data.messages.length, 4, 'pageShow resyncs the conversation');
  tab.agent.close(); advance(520);
  // structure: nothing that can scroll sits under a catchtouchmove ancestor
  const layerMarkup = read('components/guide-agent/index.wxml');
  assert(!/class="g-layer[^>]*catchtouchmove/.test(layerMarkup), 'the layer root must not catch touchmove (it contains the scroll-view)');
  assert(!/class="g-chat"[^>]*catchtouchmove/.test(layerMarkup) && !/class="g-dock [^>]*catchtouchmove/.test(layerMarkup) && !/<scroll-view[^>]*catchtouchmove/.test(layerMarkup));
  assert(/class="g-veil" catchtouchmove="noop"/.test(layerMarkup) && /class="g-head" catchtouchmove="noop"/.test(layerMarkup));
  const container = layerMarkup.match(/<page-container[^>]*>/)[0];
  for (const name of ['beforeleave', 'leave', 'afterleave']) assert(container.includes('bind:' + name + '="containerLeave"'), 'page-container binds ' + name);
  assert(!/duration="\{\{0\}\}"/.test(container), 'a zero-duration container may never report its leave transition');
  assert(/wx:if="\{\{backCapture && containerMounted\}\}"/.test(container) && /show="\{\{containerShown\}\}"/.test(container));
  assert.equal(agentDef.data.containerMounted, false, 'an idle guide instance has no page-container');
  // the layer sits in a root-portal that is inert unless guide-config layerPortal is true
  assert(/<root-portal enable="\{\{portal\}\}">\s*<view wx:if="\{\{phase !== 'idle'\}\}" class="g-layer/.test(layerMarkup) && /<\/view>\s*<\/root-portal>\s*$/.test(layerMarkup));
  assert.equal(agentDef.data.portal, false); assert.equal(config.defaults.layerPortal, false);
  fresh(); config.setForTest({ mode: 'demo', layerPortal: true }); assert.equal(makeTab(0).agent.data.portal, true); fresh();
});

// ---- 4. repeated entry and state restoration ---------------------------------
section('re-entry: later entries use the short intro; draft and conversation survive close, reopen and tab changes', () => {
  fresh();
  const first = makeTab(1);
  first.page.setData({ slide: 2 });
  first.agent.open(); advance(5000);
  assert.equal(first.agent.data.short, false);
  first.agent.ask({ currentTarget: { dataset: { question: '古水秤是水车吗？' } } });
  advance(8000);
  assert.equal(first.agent.data.messages.length, 2);
  first.agent.input({ detail: { value: '还没发出去的草稿' } });
  first.agent.close(); advance(520);
  assert.equal(first.page.data.slide, 2, 'source page state is untouched');
  assert.equal(first.page.data.guideMotion, '');
  // same tab again: short intro, same content
  first.agent.open();
  assert.equal(first.agent.data.short, true);
  advance(499); assert.equal(first.agent.data.phase, 'receding');
  advance(1); assert.equal(first.agent.data.phase, 'cinema');
  advance(900); assert.equal(first.agent.data.phase, 'reveal');
  advance(700); assert.equal(first.agent.data.phase, 'chat');
  assert.equal(first.agent.data.messages.length, 2);
  assert.equal(first.agent.data.draft, '还没发出去的草稿');
  first.agent.close(); advance(520);
  // another tab has its own tab bar instance but the same conversation
  const second = makeTab(3);
  second.agent.open(); advance(2100);
  assert.equal(second.agent.data.messages.length, 2);
  assert.equal(second.agent.data.draft, '还没发出去的草稿');
  assert.equal(second.agent.data.sourceName, '我的耕读日常');
  for (const key of Object.keys(storage)) assert(!/guide/i.test(key), 'the guide must not write storage');
});

// ---- 5. chat input and response states ----------------------------------------
section('chat: empty input, sending, streaming, done, busy guard, stop with partial text, retry, links', () => {
  fresh();
  const { agent } = makeTab(1);
  agent.open(); advance(5000);
  agent.input({ detail: { value: '   \n ' } });
  assert.equal(agent.data.canSend, false);
  agent.send();
  assert.equal(agent.data.messages.length, 0); assert.match(agent.data.hint, /先写下/);
  advance(2400); assert.equal(agent.data.hint, '');
  agent.input({ detail: { value: '  千年古樟多少岁了？ ' } });
  agent.send();
  assert.equal(agent.data.draft, ''); assert.equal(agent.data.busy, true);
  assert.equal(agent.data.messages[0].role, 'user'); assert.equal(agent.data.messages[0].text, '千年古樟多少岁了？');
  assert.equal(agent.data.messages[1].status, 'waiting');
  agent.input({ detail: { value: '第二个问题' } }); agent.send();
  assert.equal(agent.data.messages.length, 2, 'cannot send while an answer is in progress'); assert.match(agent.data.hint, /还在回答/);
  assert.equal(agent.data.draft, '第二个问题', 'a rejected send keeps the draft');
  advance(500); assert.equal(agent.data.messages[1].status, 'streaming'); assert(agent.data.messages[1].paras.length);
  advance(8000);
  const done = agent.data.messages[1];
  assert.equal(done.status, 'done'); assert.equal(done.origin, 'demo'); assert.equal(agent.data.busy, false);
  assert(done.followups.length >= 2); assert(done.cites.some(c => c.id === 'S05'));
  assert.equal(done.card.id, 0); assert.equal(done.card.photo, places[0].gallery[0].src);
  calls.navigateTo.length = 0;
  agent.openPlace({ currentTarget: { dataset: { id: 0 } } }); agent.pageHide(); agent.pageShow();
  agent.openGallery({ currentTarget: { dataset: { id: 0 } } }); agent.pageHide(); agent.pageShow();
  agent.openRoute({ currentTarget: { dataset: { id: 0 } } }); agent.pageHide(); agent.pageShow();
  assert.deepEqual(calls.navigateTo, ['/pages/place/index?id=0', '/pages/gallery/index?id=0&index=0', '/pages/visit/index?id=0']);
  agent.tapCite({ currentTarget: { dataset: { id: 'S05' } } }); assert.equal(agent.data.source.publisher, '最高人民检察院网站'); agent.closeSource();
  // stop keeps the partial answer and offers a retry
  agent.ask({ currentTarget: { dataset: { question: '讲讲村子的概况' } } });
  advance(700); agent.stop();
  const stopped = agent.data.messages[3];
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopReason, 'stopped'); assert(stopped.paras.length, 'partial text is kept');
  assert.equal(agent.data.busy, false);
  agent.retry({ currentTarget: { dataset: { id: stopped.id } } }); advance(9000);
  assert.equal(agent.data.messages[3].status, 'done'); assert.equal(agent.data.messages.length, 4, 'retry answers in place');
  // closing the guide mid-answer interrupts it and keeps what was written
  agent.ask({ currentTarget: { dataset: { question: '为什么被称为博士村？' } } });
  advance(800); agent.close(); advance(520);
  assert.equal(session.state.messages[5].status, 'stopped'); assert.equal(session.state.messages[5].stopReason, 'interrupted');
  assert.equal(session.state.busy, false);
  assert.equal(session.send('x'.repeat(501)).reason, 'long');
});

// ---- 6. provider adapter ------------------------------------------------------
section('provider: request shape, SSE and UTF-8 across chunk boundaries, non-stream fallback, error classes, timeout, cancel', () => {
  const live = Object.assign({}, config.defaults, { mode: 'live-direct', apiKey: 'sk-test', firstByteTimeoutMs: 5000 });
  const request = provider.buildRequest(live, [{ role: 'user', content: 'hi' }], true);
  assert.equal(request.url, 'https://open.cherryin.net/v1/chat/completions');
  assert.equal(provider.endpoint(Object.assign({}, live, { baseUrl: 'https://open.cherryin.net/v1/' })), 'https://open.cherryin.net/v1/chat/completions');
  assert(!/\/v1\/v1/.test(request.url));
  assert.equal(request.data.model, 'agent/qwen3-coder-30b-a3b-instruct(free)');
  assert.equal(request.header.Authorization, 'Bearer sk-test');
  const relay = provider.buildRequest(Object.assign({}, config.defaults, { mode: 'live-relay', relayUrl: 'https://relay.example/guide' }), [], true);
  assert.equal(relay.url, 'https://relay.example/guide'); assert.equal(relay.header.Authorization, undefined); assert.equal(relay.data.model, undefined);

  const encode = text => new Uint8Array(Buffer.from(text, 'utf8')).buffer;
  const sse = ['古渊头', '的水秤是分水石', '😀，不是水车。'].map(t => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n').join('') + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  const bytes = Buffer.from(sse, 'utf8');
  for (const size of [1, 2, 3, 5, 7, 64]) {
    let out = null, deltas = 0;
    provider.chat({ config: live, messages: [], onDelta: () => deltas++, onDone: r => { out = r; }, onError: e => { throw new Error(e.kind); } }, options => {
      let chunk;
      const task = { abort() {}, onChunkReceived(fn) { chunk = fn; } };
      setTimeout(() => {
        for (let i = 0; i < bytes.length; i += size) chunk({ data: new Uint8Array(bytes.subarray(i, i + size)).buffer });
        options.success({ statusCode: 200, data: '' });
      }, 10);
      assert.equal(options.enableChunked, true); assert.equal(options.method, 'POST');
      return task;
    });
    advance(20);
    assert.equal(out.text, '古渊头的水秤是分水石😀，不是水车。', 'chunk size ' + size);
    assert.equal(deltas, 3);
  }
  // platform without chunk callbacks: the whole SSE body arrives in success()
  let whole = null;
  provider.chat({ config: live, messages: [], onDone: r => { whole = r; }, onError: e => { throw new Error(e.kind); } }, options => { setTimeout(() => options.success({ statusCode: 200, data: encode(sse) }), 5); return { abort() {} }; });
  advance(10); assert.equal(whole.text, '古渊头的水秤是分水石😀，不是水车。');
  // a buffer from another JavaScript realm (as WeChat DevTools can deliver) is still decoded
  const foreign = vm.runInNewContext('(function (bytes) { var b = new ArrayBuffer(bytes.length); var v = new Uint8Array(b); for (var i = 0; i < bytes.length; i++) v[i] = bytes[i]; return b; })')(Array.from(bytes));
  assert.equal(foreign instanceof ArrayBuffer, false, 'test buffer really is cross-realm');
  assert.equal(provider.isBuffer(foreign), true);
  whole = null;
  provider.chat({ config: live, messages: [], onDone: r => { whole = r; }, onError: e => { throw new Error(e.kind); } }, options => { setTimeout(() => options.success({ statusCode: 200, data: foreign }), 5); return { abort() {} }; });
  advance(10); assert.equal(whole.text, '古渊头的水秤是分水石😀，不是水车。');
  assert.equal(provider.classify({ statusCode: 403, body: vm.runInNewContext('(function (bytes) { var b = new ArrayBuffer(bytes.length); var v = new Uint8Array(b); for (var i = 0; i < bytes.length; i++) v[i] = bytes[i]; return b; })')(Array.from(Buffer.from(JSON.stringify({ error: { message: 'x', code: 'insufficient_user_quota' } })))) }).kind, 'quota');
  // a last event without its line ending is not lost
  whole = null;
  provider.chat({ config: live, messages: [], onDone: r => { whole = r; }, onError: e => { throw new Error(e.kind); } }, options => {
    let chunk; const task = { abort() {}, onChunkReceived(fn) { chunk = fn; } };
    setTimeout(() => { chunk({ data: encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '前半' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: { content: '后半' } }] })) }); options.success({ statusCode: 200, data: '' }); }, 5);
    return task;
  });
  advance(10); assert.equal(whole.text, '前半后半');
  // without chunk callbacks only the total timeout applies, not the first-byte one
  let slow = null, slowError = null;
  provider.chat({ config: live, messages: [], onDone: r => { slow = r; }, onError: e => { slowError = e; } }, options => { setTimeout(() => options.success({ statusCode: 200, data: encode(sse) }), 30000); return { abort() {} }; });
  advance(29999); assert.equal(slowError, null, 'no first-byte timeout when the platform cannot stream'); advance(1); assert.equal(slow.text, '古渊头的水秤是分水石😀，不是水车。');
  slowError = null;
  provider.chat({ config: live, messages: [], onDone() {}, onError: e => { slowError = e; } }, () => ({ abort() {} }));
  advance(live.timeoutMs + 1999); assert.equal(slowError, null); advance(1); assert.equal(slowError.kind, 'timeout');
  // non-streaming JSON
  let plain = null;
  provider.chat({ config: Object.assign({}, live, { stream: false }), messages: [], onDone: r => { plain = r; }, onError: e => { throw new Error(e.kind); } }, options => { assert.equal(options.enableChunked, false); setTimeout(() => options.success({ statusCode: 200, data: { choices: [{ message: { content: '你好' }, finish_reason: 'length' }] } }), 5); return { abort() {} }; });
  advance(10); assert.equal(plain.text, '你好'); assert.equal(plain.truncated, true);

  const quotaBody = { error: { message: '用户额度不足, 剩余额度: ＄0.000000 (request id: x)', type: 'new_api_error', param: '', code: 'insufficient_user_quota' } };
  const table = [
    [{ statusCode: 401, body: { error: { message: 'Invalid token', code: 'invalid_api_key' } } }, 'auth'],
    [{ statusCode: 403, body: quotaBody }, 'quota'],
    [{ statusCode: 403, body: JSON.stringify(quotaBody) }, 'quota'],
    [{ statusCode: 403, body: { error: { message: 'not allowed', code: 'forbidden' } } }, 'forbidden'],
    [{ statusCode: 404, body: { error: { message: 'model not found', code: 'model_not_found' } } }, 'model'],
    [{ statusCode: 503, body: { error: { message: 'No available channel for model x', code: '' } } }, 'model'],
    [{ statusCode: 429, body: { error: { message: 'Too many requests' } } }, 'rate'],
    [{ statusCode: 500, body: 'oops' }, 'server'],
    [{ statusCode: 504, body: '' }, 'timeout'],
    [{ errMsg: 'request:fail timeout' }, 'timeout'],
    [{ errMsg: 'request:fail url not in domain list' }, 'domain'],
    [{ errMsg: 'request:fail abort' }, 'cancelled'],
    [{ errMsg: 'request:fail net::ERR_INTERNET_DISCONNECTED' }, 'network']
  ];
  for (const [input, kind] of table) {
    const result = provider.classify(input);
    assert.equal(result.kind, kind, JSON.stringify(input));
    assert(result.title && /[一-鿿]/.test(result.title));
    assert.equal(result.retryable, kind !== 'cancelled');
  }
  // HTTP error delivered through a chunked response
  let failure = null, terminal = 0;
  provider.chat({ config: live, messages: [], onDone: () => terminal++, onError: e => { failure = e; terminal++; } }, options => {
    let chunk; const task = { abort() {}, onChunkReceived(fn) { chunk = fn; } };
    setTimeout(() => { chunk({ data: encode(JSON.stringify(quotaBody)) }); options.success({ statusCode: 403, data: '' }); options.fail({ errMsg: 'late' }); }, 5);
    return task;
  });
  advance(10); assert.equal(failure.kind, 'quota'); assert.equal(failure.status, 403); assert.equal(terminal, 1, 'exactly one terminal callback');
  // error event inside a 200 stream
  failure = null;
  provider.chat({ config: live, messages: [], onDone: () => { throw new Error('unexpected'); }, onError: e => { failure = e; } }, options => { setTimeout(() => options.success({ statusCode: 200, data: 'data: ' + JSON.stringify({ error: { message: 'rate limit', code: 'rate_limit_exceeded' } }) + '\n\n' }), 5); return { abort() {} }; });
  advance(10); assert.equal(failure.kind, 'server');
  // first-byte watchdog
  let aborted = 0; failure = null;
  provider.chat({ config: live, messages: [], onDone() {}, onError: e => { failure = e; } }, () => ({ abort() { aborted++; }, onChunkReceived() {} }));
  advance(4999); assert.equal(failure, null); advance(1); assert.equal(failure.kind, 'timeout'); assert.equal(aborted, 1);
  // cancel keeps the partial text and reports once
  failure = null; terminal = 0;
  const handle = provider.chat({ config: live, messages: [], onDone: () => terminal++, onError: e => { failure = e; terminal++; } }, options => {
    let chunk; const task = { abort() { options.fail({ errMsg: 'request:fail abort' }); }, onChunkReceived(fn) { chunk = fn; } };
    setTimeout(() => chunk({ data: encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '半句' } }] }) + '\n\n') }), 5);
    return task;
  });
  advance(10); handle.abort(); handle.abort();
  assert.equal(failure.kind, 'cancelled'); assert.equal(failure.partial, '半句'); assert.equal(terminal, 1);
  advance(60000); assert.equal(terminal, 1);
  // empty 200
  failure = null;
  provider.chat({ config: live, messages: [], onDone() {}, onError: e => { failure = e; } }, options => { setTimeout(() => options.success({ statusCode: 200, data: 'data: [DONE]\n\n' }), 5); return { abort() {} }; });
  advance(10); assert.equal(failure.kind, 'empty');
  // demo mode never calls the transport
  let sent = 0; failure = null;
  provider.chat({ config: Object.assign({}, config.defaults), messages: [], onDone() {}, onError: e => { failure = e; } }, () => { sent++; return { abort() {} }; });
  advance(5); assert.equal(sent, 0); assert.equal(failure.kind, 'config');
  // config guards
  config.setForTest({ mode: 'live-direct', apiKey: '' }); assert.equal(config.get().mode, 'demo');
  config.setForTest({ mode: 'live-relay', relayUrl: '' }); assert.equal(config.get().mode, 'demo');
  config.setForTest({ mode: 'nonsense' }); assert.equal(config.get().mode, 'demo');
});

// ---- 7. provider failures inside the chat --------------------------------------
section('chat with a failing provider: error card, retry, labeled demo fallback, draft kept, live answer rendering', () => {
  fresh();
  config.setForTest({ mode: 'live-direct', apiKey: 'sk-test' });
  const quota = JSON.stringify({ error: { message: '用户额度不足, 剩余额度: ＄0.000000', code: 'insufficient_user_quota' } });
  let mode = 'quota';
  const seen = [];
  session.setTransportForTest(options => {
    seen.push(options);
    let chunk; const task = { abort() { options.fail({ errMsg: 'request:fail abort' }); }, onChunkReceived(fn) { chunk = fn; } };
    setTimeout(() => {
      if (mode === 'quota') { chunk({ data: new Uint8Array(Buffer.from(quota)).buffer }); options.success({ statusCode: 403, data: '' }); }
      else if (mode === 'offline') options.fail({ errMsg: 'request:fail net::ERR_INTERNET_DISCONNECTED' });
      else {
        const text = '**水秤**不是水车，而是渠中的分水石 [S03]。\n它按用户和田亩的需要分配水量。\n追问：为什么分水石能讲公平？｜水渠的水能喝吗？';
        for (const piece of text.match(/[\s\S]{1,9}/g)) chunk({ data: new Uint8Array(Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')).buffer });
        options.success({ statusCode: 200, data: '' });
      }
    }, 200);
    return task;
  });
  const { agent } = makeTab(1);
  agent.open(); advance(5000);
  assert.equal(agent.data.live, true); assert.equal(agent.data.modeLabel, '在线讲解');
  agent.input({ detail: { value: '古水秤是水车吗？' } }); agent.send();
  agent.input({ detail: { value: '下一条草稿' } });
  advance(300);
  let message = agent.data.messages[1];
  assert.equal(message.status, 'error'); assert.equal(message.error.kind, 'quota'); assert.equal(message.error.retryable, true); assert.match(message.error.code, /403/);
  assert.equal(agent.data.busy, false); assert.equal(agent.data.draft, '下一条草稿', 'failure must not lose the draft');
  assert.equal(seen[0].url, 'https://open.cherryin.net/v1/chat/completions');
  assert.equal(seen[0].data.model, 'agent/qwen3-coder-30b-a3b-instruct(free)');
  const sentPrompt = seen[0].data.messages;
  assert.equal(sentPrompt[0].role, 'system'); assert.match(sentPrompt[sentPrompt.length - 1].content, /<资料 出处=/);
  mode = 'offline'; agent.retry({ currentTarget: { dataset: { id: message.id } } }); advance(300);
  assert.equal(agent.data.messages[1].error.kind, 'network');
  agent.retryDemo({ currentTarget: { dataset: { id: message.id } } }); advance(9000);
  message = agent.data.messages[1];
  assert.equal(message.status, 'done'); assert.equal(message.origin, 'demo', 'fallback answers are labeled as demo, never as live');
  mode = 'ok'; agent.ask({ currentTarget: { dataset: { question: '那它为什么能讲公平？' } } }); advance(400);
  message = agent.data.messages[3];
  assert.equal(message.status, 'done'); assert.equal(message.origin, 'live');
  const text = message.paras.map(p => p.spans.map(s => s.text).join('')).join('\n');
  assert(!/\*\*|追问/.test(text), 'markdown and the follow-up line are not shown as body text');
  assert.deepEqual(message.followups, ['为什么分水石能讲公平？', '水渠的水能喝吗？']);
  assert.deepEqual(message.cites.map(c => c.id), ['S03']);
  assert.equal(message.card.id, 1, 'a contextual follow-up keeps the scenic point');
  const followPrompt = seen[seen.length - 1].data.messages;
  assert(followPrompt.some(m => m.role === 'assistant'), 'conversation context is sent with a follow-up');
  session.setTransportForTest(null);
});

// ---- 8. knowledge grounding ------------------------------------------------------
section('knowledge: DOCX-derived chunks, retrieval for village and four scenic points, facts, limits, prompt rules', () => {
  const docx = require('./lib/project-paths.cjs').knowledge;
  if (fs.existsSync(docx)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(docx)).digest('hex'), knowledge.docxSha256, 'knowledge module is stale: re-run build-guide-knowledge.cjs');
  assert(knowledge.chunks.length >= 60); assert.equal(knowledge.chunks.filter(c => c.kind === 'qa').length, 23);
  for (const id of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12']) assert(knowledge.sources[id] && knowledge.sources[id].title, 'missing source ' + id);
  const expect = [
    ['古渊头村在哪里，有多少年历史？', ['Q01', 'Q02'], 'village'],
    ['千年古樟有什么故事？', ['APP-0', 'K6-2', 'Q11', 'Q12'], 0],
    ['乌竹溪古水秤是做什么用的？', ['K5-3', 'Q14', 'APP-1'], 1],
    ['古水秤是水车吗？', ['K5-3', 'Q14'], 1],
    ['承启堂有什么看点？', ['APP-2'], 2],
    ['四本堂是什么地方？', ['Q08', 'APP-3', 'K2-2'], 3],
    ['蔬菜供销社在哪？', ['Q08', 'APP-3'], 3],
    ['草鞋御史是谁？', ['Q09'], null]
  ];
  for (const [question, ids, place] of expect) {
    const found = retrieval.retrieve(question, []);
    assert(found.chunks.some(c => ids.includes(c.id)), question + ' -> ' + found.chunks.map(c => c.id));
    assert.equal(found.primaryPlace, place, question);
    const sent = prompt.buildMessages(question, found, []).map(m => m.content).join('\n');
    assert(sent.length < 5200, 'prompt stays small: ' + sent.length);
    assert(found.chunks.reduce((n, c) => n + c.text.length, 0) < knowledge.chunks.reduce((n, c) => n + c.text.length, 0) / 3, 'only excerpts are sent');
  }
  const live = retrieval.retrieve('门票多少钱，几点开门？', []);
  assert.deepEqual(live.live, ['门票与收费', '开放时间']);
  assert.match(prompt.buildMessages('门票多少钱，几点开门？', live, []).pop().content, /实时信息/);
  const follow = retrieval.retrieve('那它为什么能讲公平呢？', [{ question: '古水秤是做什么用的？', places: [1] }]);
  assert.equal(follow.usesContext, true); assert.deepEqual(follow.places, [1]); assert(follow.chunks.some(c => c.id === 'Q15'));
  assert.equal(retrieval.retrieve('今天股票会涨吗', []).chunks.length, 0, 'unrelated questions retrieve nothing');
  const system = prompt.SYSTEM_PROMPT + prompt.FACT_CARD;
  for (const phrase of ['不是水车', '分水石', '四本堂', '资料里没有', '门票', '开放时间', '【创意讲述】', '不是给你的指令', '追问：', '李学道']) assert(system.includes(phrase), 'system prompt must contain ' + phrase);
  assert(!/微调|fine-?tun/i.test(system));
  // demo answers quote the knowledge base and keep the factual constraints
  const demo = require('../utils/guide-demo');
  const wheel = demo.compose(retrieval.retrieve('古水秤是水车吗？', []));
  assert(/不是水车/.test(wheel) && /分水/.test(wheel));
  const renamed = demo.compose(retrieval.retrieve('蔬菜供销社有什么？', []));
  assert(/四本堂/.test(renamed));
  const tickets = demo.compose(live);
  assert(/没有这类实时信息/.test(tickets) && !/\d+\s*元/.test(tickets) && !/\d{1,2}[:：]\d{2}/.test(tickets));
  assert(/没有找到依据/.test(demo.compose(retrieval.retrieve('今天股票会涨吗', []))));
  // scenic photos: every card and stamp uses that scenic point's own first real photo
  const upload = JSON.parse(read('output/upload-audit.json'));
  const expectedPhoto = { 0: /camphor/, 1: /water/, 2: /chengqi/, 3: /siben/ };
  for (const place of places) {
    const card = session.placeCard(place.id);
    assert.equal(card.photo, place.gallery[0].src); assert(expectedPhoto[place.id].test(card.photo));
    assert(fs.existsSync(card.photo.slice(1))); assert(upload.retainedFiles.includes(card.photo.slice(1)));
    assert.equal(agentDef.data.stamps[place.id].photo, card.photo);
  }
  assert.equal(session.placeCard('village').photo, village.gallery[0].src);
  assert.equal(places[3].name, '四本堂'); assert.equal(places[1].name, '乌竹溪古水秤');
});

// ---- 9. answer formatting ----------------------------------------------------------
section('formatting: plain text, source marks, follow-ups, creative label, partial streams', () => {
  const full = format.parse('【创意讲述】\n## 樟下\n**我**是村口的老樟树 [S02、S05]。\n- 请不要踩我的根。\n\n追问：古樟多少岁？｜为什么叫樟树爹？｜怎么保护古树？｜第四个');
  assert.equal(full.creative, true);
  assert.deepEqual(full.cites.map(c => c.id), ['S02', 'S05']);
  assert.deepEqual(full.followups, ['古樟多少岁？', '为什么叫樟树爹？', '怎么保护古树？']);
  assert(!/[#*]|创意讲述|追问/.test(full.body));
  assert.match(full.cites[0].label, /^S02 浙江日报 2016$/);
  const partial = format.parse('水秤是分水石 [S03]。\n追问：为什么');
  assert.equal(partial.body, '水秤是分水石 [S03]。');
  assert.equal(format.parse('见 [S99] 与（S03）').cites.length, 1, 'unknown source ids are not turned into chips');
  assert.equal(format.sourceDetail('S03').date, '2023-08-16');
});

// ---- 10. title, runtime constraints, packaging ----------------------------------------
section('product constraints: exact title glyphs, native-only APIs, photo viewer fix, packaging and credentials', () => {
  assert.deepEqual([...TITLE].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()), ['U+53E4', 'U+6751', 'U+95EE', 'U+5730']);
  const agentMarkup = read('components/guide-agent/index.wxml');
  const glyphs = [...agentMarkup.matchAll(/class="g-char g-char-\d">(.)<\/text>/g)].map(m => m[1]).join('');
  assert.equal(glyphs, TITLE);
  assert(agentMarkup.includes('aria-label="' + TITLE + '"'));
  assert(read('custom-tab-bar/index.wxml').includes('>' + TITLE + '</text>'));
  assert(!/\\u53e4|U\+53E4/.test(agentMarkup + read('custom-tab-bar/index.wxml')));
  const runtime = ['custom-tab-bar/index.js', 'components/guide-agent/index.js', ...fs.readdirSync('utils').filter(f => /^guide-/.test(f)).map(f => 'utils/' + f)];
  for (const file of runtime) {
    const code = read(file).replace(/\/\/.*$/gm, '');
    for (const banned of [/\bfetch\s*\(/, /\bdocument\./, /\bwindow\./, /XMLHttpRequest/, /TextDecoder/, /\bprocess\./, /require\(['"]node:/, /localStorage/, /wx\.previewImage\s*\(/, /localhost|127\.0\.0\.1/]) {
      assert(!banned.test(code), file + ' uses ' + banned);
    }
  }
  for (const file of ['components/guide-agent/index.wxss', 'custom-tab-bar/index.wxss']) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@import[^;]+;/g, '');
    for (const rule of css.split('}')) {
      const selector = rule.split('{')[0].trim();
      if (!selector) continue;
      for (const part of selector.split(',')) assert(/^(\s*\.[\w-]+)+$/.test(part.replace(/\s+/g, ' ')), file + ': component selectors must be class-only, got "' + part.trim() + '"');
    }
  }
  for (const file of ['pages/place/index.js', 'pages/village/index.js']) assert(!read(file).includes('wx.previewImage('));
  const project = JSON.parse(read('project.config.json'));
  assert.equal(project.setting.urlCheck, true, 'request-domain validation must stay enabled');
  const upload = JSON.parse(read('output/upload-audit.json'));
  for (const file of ['custom-tab-bar/index.js', 'custom-tab-bar/index.json', 'custom-tab-bar/index.wxml', 'custom-tab-bar/index.wxss',
    'components/guide-agent/index.js', 'components/guide-agent/index.json', 'components/guide-agent/index.wxml', 'components/guide-agent/index.wxss', 'components/guide-agent/art.wxss',
    ...runtime.filter(f => f.startsWith('utils/'))]) assert(upload.retainedFiles.includes(file), 'not packaged: ' + file + ' (run check-upload.cjs first)');
  assert(!upload.retainedFiles.some(f => f.startsWith('scripts/')));
  const local = read('utils/guide-config.local.js');
  const hasKey = /apiKey\s*:\s*['"][^'"]+['"]/.test(local);
  if (process.argv.includes('--release')) assert(!hasKey, 'release builds must not embed an API key; use live-relay');
  else if (hasKey) console.log('NOTE: utils/guide-config.local.js embeds a development API key (live-direct). Do not upload this build; see IMPLEMENTATION_REPORT.md.');
  const everything = runtime.filter(f => f !== 'utils/guide-config.local.js').map(read).join('\n') + agentMarkup;
  assert(!/sk-[A-Za-z0-9]{20,}/.test(everything), 'no credential in shared source');
});

Date.now = realNow;
console.log('PASS: ' + results.length + ' guide check groups (logic only; no rendering, no WeChat runtime).');
