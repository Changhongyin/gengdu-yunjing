// The floating village companion (阿樟) as it appears on one page.
// State that must survive navigation lives in utils/pet-controller.js; this
// component renders it, arbitrates gestures on the character, and shows the
// reaction and introduction bubbles. On pages without the custom tab bar it
// also hosts the existing guide layer, so the same conversation opens everywhere.
//
// Touch contract (thresholds in utils/pet-gesture.js):
//   single tap  -> one short reaction bubble, never the chat
//   long press  -> the existing guide conversation, once, and no tap on release
//   drag        -> moves the companion; no tap and no chat
const pet = require('../../utils/pet-controller');
const gestures = require('../../utils/pet-gesture');
const intros = require('../../utils/pet-intros');
const entry = require('../../utils/guide-entry');

// Order of the cells in /assets/pet/azhang-poses.png (4 columns x 3 rows).
const POSES = ['greet', 'cheer', 'think', 'read', 'scroll', 'walk', 'point', 'fish', 'approve', 'shy', 'sleep', 'celebrate'];
const CELL_RATIO = 304 / 256;
const SIZE_RPX = { full: 132, quiet: 120, compact: 100 };
const TAB_RPX = 84;
const MARGIN_PX = 8;
const IDLE = { full: 'scroll', quiet: 'read', compact: 'read' };
// Milliseconds.
const TIMING = { reactHold: 4200, introHold: 12000, hintHold: 6500, celebrateHold: 3800, revealStep: 45, hintDelay: 1300, sleepAfter: 75000, dragFrame: 16 };
const REVEAL_CHARS = 3;
const ONE_SHOT = ['wave', 'pop', 'hop', 'squish', 'talk', 'nod', 'splash', 'jump'];

function frame(name) {
  const index = Math.max(0, POSES.indexOf(name));
  return { col: index % 4, row: Math.floor(index / 4), pose: POSES[index] };
}
function metrics() {
  let info = {};
  try { info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (error) { info = {}; }
  const ww = info.windowWidth || 375, wh = info.windowHeight || 603;
  const safeBottom = info.safeArea && info.screenHeight ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
  return { ww, wh, safeBottom };
}

Component({
  // covered: the page has a sheet open (task sheet, journal composer). The companion
  // is drawn above all page content, so it steps aside explicitly instead of
  // relying on z-index to sit under the sheet.
  properties: { docked: { type: Boolean, value: false }, covered: { type: Boolean, value: false, observer: 'coverChanged' } },
  data: {
    visible: false, away: false, portal: false, mode: 'full', minimized: false, side: 'right',
    x: 0, y: 0, w: 0, h: 0, dragging: false, pressing: false,
    col: 0, row: 1, pose: 'scroll', anim: 'idle', alt: false,
    bubble: null, bubbleUp: true, bubbleW: 0, hostGuide: false
  },
  lifetimes: {
    created() { this._timers = {}; this._active = false; this._seen = false; this._opens = 0; },
    attached() { this.setup(); },
    ready() { this.pageShow(); },
    detached() { this.pageHide(); pet.unbind(this._page, this); }
  },
  pageLifetimes: {
    show() { this.pageShow(); },
    hide() { this.pageHide(); },
    resize() { if (this._rule && this._rule.visible) this.setData(this.layout()); }
  },
  methods: {
    noop() {},
    // Finds the page this instance belongs to and applies the route policy. Runs at
    // attach and again before the first show, in case the page was not yet the top
    // of the page stack when the component attached.
    setup() {
      if (this._seen) return;
      const page = entry.currentPage();
      if (!page || page === this._page) return;
      if (this._page) pet.unbind(this._page, this);
      const rule = pet.policy(pet.routeOf(page));
      this._page = page; this._rule = rule;
      if (!rule.visible) { if (this.data.visible) this.setData({ visible: false, hostGuide: false }); return; } // defence in depth: excluded pages do not even include this component
      pet.load();
      pet.bind(page, this);
      if (!this._gesture) this._gesture = gestures.create({
        onPressStart: () => { if (!this.data.pressing) this.setData({ pressing: true }); },
        onPressEnd: () => { if (this.data.pressing) this.setData({ pressing: false }); },
        onTap: () => this.onTap(),
        onLongPress: () => this.onLongPress(),
        onDragStart: () => this.onDragStart(),
        onDragMove: move => this.onDragMove(move),
        onDragEnd: () => this.onDragEnd()
      });
      const idle = frame(IDLE[rule.mode]);
      this.setData(Object.assign({ visible: true, portal: pet.overlayPortal(), mode: rule.mode, hostGuide: !rule.tab, minimized: pet.state.minimized, col: idle.col, row: idle.row, pose: idle.pose }, this.layout()));
    },
    hidden() { return this.data.away || !!this.data.covered; },
    // The page opened or closed a sheet above the companion.
    coverChanged(covered) {
      if (!this._rule || !this._rule.visible) return;
      if (covered) {
        if (this._gesture) this._gesture.reset();
        this.clearTimers();
        if (this.data.bubble || this.data.pressing || this.data.dragging) this.setData({ bubble: null, pressing: false, dragging: false });
      } else if (this._active && !this.data.away) {
        this._asleep = false;
        this.rest();
        this.armSleep();
        this.evaluate('return'); // delivers an introduction that was cut off by the sheet
      }
    },
    // ---- timers: every timer has a name, so nothing is left behind -------------
    after(name, ms, fn) {
      this.cancel(name);
      this._timers[name] = setTimeout(() => { delete this._timers[name]; fn(); }, ms);
    },
    cancel(name) { if (this._timers[name] !== undefined) { clearTimeout(this._timers[name]); delete this._timers[name]; } },
    clearTimers() { Object.keys(this._timers).forEach(name => this.cancel(name)); },
    pendingTimers() { return Object.keys(this._timers); },

    // ---- geometry ---------------------------------------------------------------
    bounds(minimized) {
      const m = metrics(), rule = this._rule;
      const rpx = value => value * m.ww / 750;
      const w = minimized ? rpx(TAB_RPX) : rpx(SIZE_RPX[rule.mode]);
      const h = minimized ? w : w * CELL_RATIO;
      const minY = 12;
      const maxY = Math.max(minY, m.wh - m.safeBottom - rpx(rule.reserve) - h);
      const edge = minimized ? 0 : MARGIN_PX;
      return { ww: m.ww, w, h, minX: edge, maxX: m.ww - w - edge, minY, maxY, bubbleMax: rpx(500) };
    },
    layout() {
      const minimized = pet.state.minimized;
      const b = this.bounds(minimized);
      const y = b.minY + (b.maxY - b.minY) * pet.state.y;
      const side = pet.state.side;
      return { side, minimized, w: Math.round(b.w), h: Math.round(b.h), x: Math.round(side === 'left' ? b.minX : b.maxX), y: Math.round(y),
        bubbleW: Math.round(Math.min(b.bubbleMax, b.ww - b.w - MARGIN_PX * 2 - 14)), bubbleUp: y + b.h * 0.6 > 300 };
    },

    // ---- page lifecycle -----------------------------------------------------------
    pageShow() {
      this.setup();
      if (!this._rule || !this._rule.visible || this._active) return;
      this._active = true;
      const first = !this._seen;
      this._seen = true;
      const foreground = pet.takeForeground();
      const reason = first ? 'initial' : foreground ? 'foreground' : 'return';
      pet.bind(this._page, this);
      const idle = frame(IDLE[this.data.mode]);
      this.setData(Object.assign({ away: pet.chatOpenOn(this._page), bubble: null, pressing: false, dragging: false, col: idle.col, row: idle.row, pose: idle.pose, anim: 'idle' }, this.layout()));
      this.armSleep();
      if (pet.takeCelebration() && !this.data.minimized && !this.hidden()) { this.react(intros.special.celebrate, 'celebrate', TIMING.celebrateHold); return; }
      this.evaluate(reason);
    },
    // Leaving the page (another page, a tab change, the background): nothing may keep running.
    pageHide() {
      if (!this._active) return;
      this._active = false;
      if (this._gesture) this._gesture.reset();
      this.clearTimers();
      if (this.data.bubble || this.data.pressing || this.data.dragging) this.setData({ bubble: null, pressing: false, dragging: false });
    },
    // The page reported a new context (pet-controller.enter).
    contextChanged(context, reason) {
      if (!this._active || reason === 'same') return;
      this.hush();
      this.evaluate(reason);
    },
    evaluate(reason) {
      const context = pet.context(this._page);
      const decision = pet.decideIntro(context, this.data.mode, reason, Date.now());
      this._decision = decision;
      this.cancel('intro'); this.cancel('hint');
      if (decision.play) context.pending = true; // kept if the companion is hidden right now
      if (this.hidden()) return;
      if (decision.play) {
        const seq = context.seq;
        this.after('intro', pet.INTRO_DELAY_MS, () => {
          const now = pet.context(this._page);
          if (!now || now.seq !== seq || this.hidden()) return; // the scene changed while waiting, or a sheet or the chat is in front
          this.introduce(now.topic, true);
        });
      } else if (reason === 'initial' && pet.wantHint() && !this.data.minimized) {
        this.after('hint', TIMING.hintDelay, () => { if (pet.wantHint()) { pet.hintShown(); this.react(intros.special.hint, 'hint', TIMING.hintHold); } });
      }
    },

    // ---- character --------------------------------------------------------------
    setPose(name, anim) {
      const f = frame(name);
      const patch = { col: f.col, row: f.row, pose: f.pose };
      const next = anim || 'idle';
      patch.anim = next;
      // The same one-shot twice in a row needs another animation name to restart.
      patch.alt = ONE_SHOT.includes(next) && next === this.data.anim ? !this.data.alt : false;
      this._asleep = name === 'sleep';
      this.setData(patch);
    },
    rest() { if (!this._asleep) this.setPose(IDLE[this.data.mode], 'idle'); },
    armSleep() {
      this.cancel('sleep');
      if (this.data.mode !== 'full') return;
      this.after('sleep', TIMING.sleepAfter, () => { if (!this.data.bubble && !this.hidden() && !this.data.minimized) this.setPose('sleep', 'doze'); });
    },

    // ---- bubbles -------------------------------------------------------------------
    // Stops speech without counting as a dismissal by the visitor.
    hush() {
      this.cancel('intro'); this.cancel('hint'); this.cancel('reveal'); this.cancel('bubble');
      if (this.data.bubble) this.setData({ bubble: null });
    },
    say(bubble, hold, reveal) {
      this.cancel('reveal'); this.cancel('bubble');
      const full = bubble.full;
      const place = this.layout();
      this.setData({ bubble: Object.assign({}, bubble, { text: reveal ? '' : full, done: !reveal }), bubbleUp: place.bubbleUp, bubbleW: place.bubbleW });
      const finish = () => {
        if (reveal) { this.setData({ 'bubble.text': full, 'bubble.done': true }); this.rest(); }
        this.after('bubble', hold, () => { this.setData({ bubble: null }); this.rest(); });
      };
      if (!reveal) { finish(); return; }
      let shown = 0;
      const step = () => {
        shown = Math.min(full.length, shown + REVEAL_CHARS);
        if (shown >= full.length) { finish(); return; }
        this.setData({ 'bubble.text': full.slice(0, shown) });
        this.after('reveal', TIMING.revealStep, step);
      };
      this.after('reveal', TIMING.revealStep, step);
    },
    introduce(topic, automatic) {
      const content = intros.get(topic);
      if (!content) return false;
      const context = pet.context(this._page);
      if (context) context.pending = false;
      pet.markIntroduced(topic, Date.now());
      const tip = pet.wantHint();
      if (tip) pet.hintShown();
      this.cancel('intro'); this.cancel('hint');
      this.armSleep();
      this.setPose(content.greeting ? 'greet' : 'point', content.greeting ? 'wave' : 'talk');
      this.say({ kind: 'intro', topic, title: content.title, tag: content.tag, full: content.text, source: content.source, tip, automatic: !!automatic,
        actions: [{ id: 'ask', label: '问阿樟', primary: true }, { id: 'min', label: '收起' }] }, TIMING.introHold, true);
      return true;
    },
    react(item, kind, hold) {
      const context = pet.context(this._page);
      const actions = [];
      if (kind === 'react' && context && context.topic !== null && intros.get(context.topic)) actions.push({ id: 'intro', label: context.topic === 'greet' ? '再打个招呼' : '听讲解' });
      if (kind !== 'celebrate') actions.push({ id: 'ask', label: '问阿樟', primary: true });
      if (kind === 'react') actions.push({ id: 'min', label: '收起' });
      this.setPose(item.pose, item.anim);
      this.say({ kind, topic: null, title: '阿樟', tag: '', full: item.text, source: '', tip: false, actions }, hold || TIMING.reactHold, false);
    },
    // × on the bubble. Closing an introduction tells the companion not to
    // volunteer that topic again in this launch; replay stays available by tapping.
    closeBubble() {
      const bubble = this.data.bubble;
      if (!bubble) return;
      if (bubble.kind === 'intro') pet.dismiss(bubble.topic);
      this.hush();
      this.rest();
    },
    tapAction(e) {
      const id = e.currentTarget.dataset.id;
      const context = pet.context(this._page);
      if (id === 'ask') this.openChat();
      else if (id === 'intro' && context) this.introduce(context.topic, false);
      else if (id === 'min') this.minimize();
    },
    minimize() {
      this.hush(); this.cancel('sleep');
      pet.setMinimized(true);
      this.setData(this.layout());
    },
    restore() {
      if (!this.data.minimized) return;
      pet.setMinimized(false);
      this.setData(this.layout());
      this.armSleep();
      this.react(intros.special.restore, 'react');
    },

    // ---- gestures -------------------------------------------------------------------
    touchStart(e) {
      const touch = e.touches && e.touches[0];
      if (!touch || this.hidden() || this.data.minimized) return;
      this.armSleep();
      this._gesture.start({ x: touch.clientX, y: touch.clientY, count: e.touches.length });
    },
    touchMove(e) {
      const touch = e.touches && e.touches[0];
      if (touch) this._gesture.move({ x: touch.clientX, y: touch.clientY, count: e.touches.length });
    },
    touchEnd() { this._gesture.end(); },
    touchCancel() { this._gesture.cancel(); },
    onTap() {
      if (this._asleep) { this.react(intros.special.wake, 'react'); return; }
      this.react(intros.reaction(pet.context(this._page), pet.nextTap()), 'react');
    },
    onLongPress() {
      if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail() {} });
      this.hush();
      this.setPose('think', 'think');
      this.openChat();
    },
    onDragStart() {
      if (this.data.docked) return;
      this.hush();
      const b = this.bounds(false);
      this._drag = { x: this.data.x, y: this.data.y, at: 0, bounds: b, nx: this.data.x, ny: this.data.y };
      this.setData({ dragging: true, pressing: false });
    },
    onDragMove(move) {
      const drag = this._drag;
      if (!drag) return;
      const b = drag.bounds;
      drag.nx = Math.min(b.maxX, Math.max(b.minX, drag.x + move.dx));
      drag.ny = Math.min(b.maxY, Math.max(b.minY, drag.y + move.dy));
      const now = Date.now();
      if (now - drag.at < TIMING.dragFrame) return;
      drag.at = now;
      this.setData({ x: Math.round(drag.nx), y: Math.round(drag.ny) });
    },
    // Release (or cancellation) snaps to the nearer side and keeps the height as a
    // ratio of the usable range, so the position stays reachable after a resize.
    onDragEnd() {
      const drag = this._drag;
      this._drag = null;
      if (!drag) { if (this.data.dragging) this.setData({ dragging: false }); return; }
      const b = drag.bounds;
      const side = drag.nx + b.w / 2 < b.ww / 2 ? 'left' : 'right';
      pet.setPosition(side, b.maxY > b.minY ? (drag.ny - b.minY) / (b.maxY - b.minY) : 0);
      this.setData(Object.assign({ dragging: false }, this.layout()));
      this.rest();
    },

    // ---- chat ---------------------------------------------------------------------
    // Opens the existing guide layer of this page with the current scenic context.
    // The layer itself ignores a second open, so one hold can only ever open one chat.
    openChat() {
      const page = this._page;
      const options = { context: pet.chatContext(page), from: 'companion' };
      let opened = false;
      if (this._rule.tab) {
        const bar = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null;
        if (bar && typeof bar.openGuideWith === 'function') opened = bar.openGuideWith(options) === true;
      } else {
        const agent = this.selectComponent('#pet-guide');
        if (agent) opened = agent.open(options) === true;
      }
      if (opened) this._opens += 1; else this.rest();
      return opened;
    },
    onGuidePhase(e) { pet.chatPhase(this._page, e.detail.phase); },
    // pet-controller.chatPhase: the guide layer of this page opened or closed.
    chatChanged(open) {
      if (open === this.data.away) return;
      if (open) {
        if (this._gesture) this._gesture.reset(); // the release of the opening long press must not become a tap
        this.clearTimers();
        this.setData({ away: true, bubble: null, pressing: false });
      } else {
        const idle = frame(IDLE[this.data.mode]);
        this.setData(Object.assign({ away: false, col: idle.col, row: idle.row, pose: idle.pose, anim: 'idle' }, this.layout()));
        this._asleep = false;
        if (this._active && !this.data.covered) { this.armSleep(); this.evaluate('return'); }
      }
    }
  }
});
