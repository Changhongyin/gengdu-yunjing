// Guide layer: entry cinematic plus chat, rendered above the current tab page.
// There is no route change, so the source page keeps its scroll and state.
const session = require('../../utils/guide-session');
const entry = require('../../utils/guide-entry');
const format = require('../../utils/guide-format');
const configStore = require('../../utils/guide-config');
const backOwner = require('../../utils/guide-back');
const { places, village } = require('../../utils/places');

// Milliseconds. Keep in sync with index.wxss (documented in the design plan).
const TIMING = {
  recede: 700, cinema: 3400, reveal: 900, leave: 520,
  shortRecede: 500, shortCinema: 900, shortReveal: 700
};
const NAV_TITLE = '樟下问答';
// The back catcher (<page-container>) exists only while this layer is open on the
// visible page and holds the ownership token in utils/guide-back.js: the platform
// allows one instance. It is mounted hidden first and shown in a later update
// (CONTAINER_ARM), because showing it in the update that creates it is not reliable.
const CONTAINER_ARM = 80;
// After a handled back press it is re-armed only once its own leave transition has finished.
const CONTAINER_REARM = 320;
const numerals = ['壹', '贰', '叁', '肆', '伍', '陆'];
const stamps = places.map((place, index) => ({
  id: place.id, name: place.name, no: numerals[index], photo: place.gallery[0].src, question: '给我讲讲' + place.name
}));
const suggestions = [
  { text: '古渊头为什么叫这个名字？' },
  { text: '古水秤是水车吗？它怎么分水？' },
  { text: '为什么这里被称为“博士村”？' },
  { text: '带孩子来，可以引导他观察什么？' },
  { text: '请以古樟的口吻，讲一个樟下的小故事', creative: true }
].map((item, index) => Object.assign({ no: numerals[index] }, item));
// Where the visitor is when the layer opens: { place: 0..3 | 'village' } or null.
function contextData(context) {
  const place = context ? context.place : null;
  if (place === 'village') return { contextName: village.name, contextQuestion: '介绍一下古渊头村的概况' };
  if (places[place]) return { contextName: places[place].name, contextQuestion: '给我讲讲' + places[place].name };
  return { contextName: '', contextQuestion: '' };
}
const view = message => message.role === 'user'
  ? { id: message.id, role: 'user', text: message.text }
  : { id: message.id, role: 'guide', status: message.status, origin: message.origin, paras: message.paras, cites: message.cites,
      followups: message.followups, card: message.card, creative: !!message.creative, error: message.error,
      stopReason: message.stopReason || '', truncated: !!message.truncated };

Component({
  data: {
    phase: 'idle', short: false, skipped: false, chatMounted: false, containerMounted: false, containerShown: false, backCapture: false, portal: false,
    messages: [], draft: '', draftLength: 0, canSend: false, busy: false, hint: '',
    keyboard: 0, focused: false, scrollTop: 0, showJump: false,
    live: false, modeLabel: '离线演示', modeHint: '', sourceName: '', source: null, contextName: '', contextQuestion: '',
    stamps, suggestions, maxLength: session.MAX_QUESTION
  },
  lifetimes: {
    created() { this._timers = []; this._run = 0; this._stick = true; this._scrollSeq = 0; this._marks = {}; },
    // Only configuration is read here. No <page-container> is created while idle.
    attached() {
      const config = configStore.get();
      const backCapture = config.backCapture !== false, portal = config.layerPortal === true;
      if (backCapture !== this.data.backCapture || portal !== this.data.portal) this.setData({ backCapture, portal });
    },
    detached() {
      const open = this.data.phase !== 'idle';
      this.clearTimers();
      clearTimeout(this._hintTimer);
      clearTimeout(this._rearmTimer);
      backOwner.release(this);
      this.unbind();
      if (open) session.stop('interrupted'); // an idle instance must not stop another tab's answer
    }
  },
  pageLifetimes: {
    hide() { this.pageHide(); },
    show() { this.pageShow(); }
  },
  methods: {
    noop() {},
    isOpen() { return this.data.phase !== 'idle'; },
    timeline() { return Object.assign({ timing: TIMING }, this._marks); },
    after(ms, fn) {
      const run = this._run;
      const timer = setTimeout(() => { if (run === this._run) fn(); }, ms);
      this._timers.push(timer);
    },
    clearTimers() {
      this._timers.forEach(clearTimeout);
      this._timers = [];
      this._run++;
    },
    setPhase(phase, extra) {
      this._marks[phase] = Date.now();
      this.setData(Object.assign({ phase }, extra || {}));
      this.triggerEvent('phase', { phase });
    },
    bind() {
      this._listener = message => this.onMessage(message);
      session.subscribe(this._listener);
    },
    unbind() { if (this._listener) session.unsubscribe(this._listener); this._listener = null; },
    modeData() {
      const mode = session.mode();
      const live = mode !== 'demo';
      return { live, modeLabel: live ? '在线讲解' : '离线演示',
        modeHint: live ? '当前由在线模型回答，并以村落知识库为依据。' : '当前为离线演示：回答直接引用知识库原文，不是模型生成。' };
    },

    // ---- entry -----------------------------------------------------------
    // options.context: the scenic context of the page the layer opens from (see contextData).
    open(options) {
      if (this.data.phase !== 'idle') return false; // repeated taps and holds are ignored
      this.clearTimers();
      const context = options && options.context ? options.context : null;
      session.setContext(context);
      const short = session.state.introPlayed;
      const config = configStore.get();
      const page = entry.setMotion('guide-out', config.lockPageScroll);
      this._page = page;
      this._navigating = false;
      this._containerLost = false;
      this._marks = { tap: Date.now() };
      this._stick = true;
      this.bind();
      this.setPhase('receding', Object.assign({
        short, skipped: false, chatMounted: false, scrollTop: 0, keyboard: 0, focused: false, hint: '', source: null, showJump: false,
        backCapture: config.backCapture !== false, containerShown: false,
        messages: session.state.messages.map(view), busy: session.state.busy,
        draft: session.state.draft, draftLength: session.state.draft.length, canSend: !!session.state.draft.trim(),
        sourceName: entry.titleOf(page || entry.currentPage())
      }, contextData(context), this.modeData()));
      entry.setTitle(NAV_TITLE);
      this.mountContainer();
      this.after(short ? TIMING.shortRecede : TIMING.recede, () => {
        this.setPhase('cinema');
        this.after(short ? TIMING.shortCinema : TIMING.cinema, () => this.reveal());
      });
      return true;
    },
    reveal() {
      session.state.introPlayed = true;
      this.setPhase('reveal', { chatMounted: true });
      this.after(this.data.short ? TIMING.shortReveal : TIMING.reveal, () => this.settleChat());
    },
    settleChat() {
      session.state.introPlayed = true;
      this.setPhase('chat', { chatMounted: true });
      if (this.data.messages.length) this.scrollBottom(true);
    },
    skip() {
      if (!['receding', 'cinema'].includes(this.data.phase)) return;
      this.clearTimers();
      this.setData({ skipped: true });
      this.reveal();
    },

    // ---- exit ------------------------------------------------------------
    close() {
      const phase = this.data.phase;
      if (phase === 'idle' || phase === 'leaving') return false;
      this.clearTimers();
      session.stop('interrupted');
      clearTimeout(this._rearmTimer);
      if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail() {} });
      entry.setMotion('guide-in', false, this._page);
      entry.restoreTitle();
      this.setPhase('leaving', { containerShown: false, keyboard: 0, focused: false, source: null, hint: '' });
      this.after(TIMING.leave, () => this.settleIdle());
      return true;
    },
    settleIdle() {
      this.releaseContainer(); // its leave transition (100 ms) ended during the 520 ms exit
      this.unbind();
      clearTimeout(this._hintTimer);
      entry.setMotion('', false, this._page);
      this._page = null;
      this.setPhase('idle', { chatMounted: false, containerShown: false, skipped: false });
    },
    // Hardware or gesture back while the layer is open. Bound to beforeleave, leave
    // and afterleave (whichever the base library delivers); only the first one acts,
    // because every branch below clears containerShown or marks the container lost.
    containerLeave() {
      if (!this.data.containerShown) return; // hidden by us, or this back is already handled
      if (this._hidden || this._navigating) { this._containerLost = true; return; } // leaving for another page is not "back"
      if (this.data.source) { this.setData({ source: null }); this.rearmContainer(); return; } // back closes the source sheet first
      this.close();
    },
    // ---- back catcher lifecycle ----------------------------------------------
    // Mounts the catcher hidden and takes the token; any other instance unmounts its own.
    mountContainer() {
      if (!this.data.backCapture) return;
      backOwner.claim(this);
      this._containerLost = false;
      if (!this.data.containerMounted || this.data.containerShown) this.setData({ containerMounted: true, containerShown: false });
      this.armContainer(CONTAINER_ARM);
    },
    armContainer(delay) {
      clearTimeout(this._rearmTimer);
      this._rearmTimer = setTimeout(() => {
        this._rearmTimer = null;
        if (this._hidden || ['idle', 'leaving'].includes(this.data.phase)) return;
        if (!backOwner.owns(this) || !this.data.containerMounted || this.data.containerShown) return;
        this.setData({ containerShown: true });
      }, delay);
    },
    // Unmounts the catcher and gives up the token. Safe to call at any time.
    releaseContainer() {
      clearTimeout(this._rearmTimer);
      this._rearmTimer = null;
      backOwner.release(this);
      if (this.data.containerMounted || this.data.containerShown) this.setData({ containerMounted: false, containerShown: false });
    },
    rearmContainer() {
      this._containerLost = false;
      if (!this.data.backCapture) return;
      if (!this.data.containerMounted || !backOwner.owns(this)) { this.mountContainer(); return; }
      if (this.data.containerShown) this.setData({ containerShown: false });
      this.armContainer(CONTAINER_REARM);
    },

    // ---- page lifecycle --------------------------------------------------
    pageHide() {
      const phase = this.data.phase;
      this._hidden = true;
      if (phase === 'idle') return;
      this.clearTimers();
      clearTimeout(this._rearmTimer);
      session.stop('interrupted');
      if (phase === 'leaving') { entry.restoreTitle(); this.settleIdle(); return; }
      if (phase !== 'chat') this.settleChat(); // never resume half-way through the intro
      // A hidden page keeps its conversation but not the catcher: another page may need it.
      this.releaseContainer();
    },
    pageShow() {
      this._hidden = false;
      this._navigating = false;
      if (this.data.phase !== 'chat') return;
      entry.setTitle(NAV_TITLE);
      // The conversation is shared by all four tab pages: take the listener back and
      // resync in case another tab's layer used it while this page was hidden.
      this.bind();
      const state = session.state;
      if (state.messages.length !== this.data.messages.length || state.busy !== this.data.busy) {
        this.setData({ messages: state.messages.map(view), busy: state.busy });
      }
      // Re-arm back capture after returning from a linked page or from the background.
      if (this._containerLost || !this.data.containerShown) this.rearmContainer();
    },

    // ---- conversation ----------------------------------------------------
    onMessage(message) {
      if (!this.data.chatMounted && this.data.phase === 'idle') return;
      const index = this.data.messages.findIndex(item => item.id === message.id);
      const patch = { busy: session.state.busy };
      patch['messages[' + (index < 0 ? this.data.messages.length : index) + ']'] = view(message);
      this.setData(patch);
      if (this._stick) this.scrollBottom(false);
    },
    ask(e) {
      const question = e.currentTarget.dataset.question;
      if (question) this.submit(question, false);
    },
    send() { this.submit(this.data.draft, true); },
    submit(text, fromInput) {
      const result = session.send(text);
      if (!result.ok) {
        const hints = { empty: '先写下想问的内容，再点“问”。', busy: '阿樟还在回答上一个问题，可以先点停止。', long: '问题有点长，请精简到 ' + session.MAX_QUESTION + ' 字以内。' };
        this.showHint(hints[result.reason] || '暂时不能发送，请稍后再试。');
        return;
      }
      this._stick = true;
      const patch = { hint: '', showJump: false };
      if (fromInput) Object.assign(patch, { draft: '', draftLength: 0, canSend: false });
      this.setData(patch);
      this.scrollBottom(true);
    },
    stop() { session.stop('stopped'); },
    retry(e) { if (session.retry(e.currentTarget.dataset.id, false)) { this._stick = true; this.scrollBottom(true); } },
    retryDemo(e) { if (session.retry(e.currentTarget.dataset.id, true)) { this._stick = true; this.scrollBottom(true); } },
    showHint(hint) {
      this.setData({ hint });
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => { if (this.data.hint === hint) this.setData({ hint: '' }); }, 2400);
    },
    tapMode() { this.showHint(this.data.modeHint); },

    // ---- input, keyboard, scrolling ---------------------------------------
    input(e) {
      const draft = e.detail.value;
      session.setDraft(draft);
      this.setData({ draft, draftLength: draft.length, canSend: !!draft.trim() });
    },
    focus() { this.setData({ focused: true }); },
    blur() { this.setData({ focused: false, keyboard: 0 }); },
    blurInput() { if (this.data.focused && typeof wx.hideKeyboard === 'function') wx.hideKeyboard({ fail() {} }); },
    keyboardChange(e) {
      const keyboard = Math.max(0, Math.round(e.detail.height || 0));
      if (keyboard === this.data.keyboard) return;
      this.setData({ keyboard });
      if (keyboard) this.scrollBottom(true);
    },
    onScroll(e) {
      const detail = e.detail;
      this._viewHeight = this._viewHeight || 0;
      if (!this._viewHeight) this.measure();
      const gap = detail.scrollHeight - detail.scrollTop - (this._viewHeight || 600);
      this._stick = gap < 140;
      const showJump = !this._stick && this.data.messages.length > 0;
      if (showJump !== this.data.showJump) this.setData({ showJump });
    },
    measure() {
      this.createSelectorQuery().select('.g-scroll').boundingClientRect(rect => { if (rect && rect.height) this._viewHeight = rect.height; }).exec();
    },
    scrollBottom(force) {
      if (force) this._stick = true;
      this._viewHeight = 0;
      this._scrollSeq += 1;
      this.setData({ scrollTop: 1000000 + this._scrollSeq, showJump: false });
    },
    jumpBottom() { this.scrollBottom(true); },

    // ---- links into the existing pages -------------------------------------
    // _navigating marks the container closing that some base libraries deliver
    // before the page's onHide, so it is not mistaken for a back press.
    go(url) {
      if (this._navigating) return;
      this._navigating = true;
      wx.navigateTo({ url, fail: () => { this._navigating = false; } });
    },
    openPlace(e) { this.go('/pages/place/index?id=' + e.currentTarget.dataset.id); },
    openGallery(e) { this.go('/pages/gallery/index?id=' + e.currentTarget.dataset.id + '&index=0'); },
    openRoute(e) { this.go('/pages/visit/index?id=' + e.currentTarget.dataset.id); },
    tapCite(e) { const source = format.sourceDetail(e.currentTarget.dataset.id); if (source) this.setData({ source }); },
    closeSource() { this.setData({ source: null }); }
  }
});
