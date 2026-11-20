// One shared guide conversation for the whole mini-program launch.
// Memory only: nothing here touches the existing storage keys.
const configStore = require('./guide-config');
const provider = require('./guide-provider');
const retrieval = require('./guide-retrieval');
const prompt = require('./guide-prompt');
const format = require('./guide-format');
const demo = require('./guide-demo');
const { places, village } = require('./places');

const FLUSH_MS = 90;
const MAX_QUESTION = 500;
// context: where the visitor opened the guide from, { place: 0..3 | 'village' } or null.
const state = { messages: [], draft: '', busy: false, introPlayed: false, context: null };
let serial = 0, active = null, listener = null;
let transport = null; // test hook; defaults to wx.request inside the provider

const notify = message => { if (listener) listener(message); };
const nextId = prefix => prefix + (++serial);

function placeCard(id) {
  if (id === null || id === undefined) return null;
  const place = id === 'village' ? village : places[id];
  if (!place) return null;
  return { id: place.id, name: place.name, kicker: place.kicker, photo: place.gallery[0].src, caption: place.gallery[0].caption, isVillage: place.id === 'village' };
}
function applyText(message, raw, final) {
  const parsed = format.parse(raw);
  message.raw = raw;
  message.paras = parsed.paras;
  message.cites = parsed.cites;
  message.creative = parsed.creative;
  message.text = parsed.body;
  if (final) message.followups = parsed.followups;
}
function history() {
  const turns = [];
  for (const message of state.messages) {
    if (message.role === 'guide' && message.status === 'done' && message.text) {
      turns.push({ question: message.question, answer: message.text, places: message.places || [] });
    }
  }
  return turns;
}
function finish(message, status) {
  message.status = status;
  state.busy = false;
  active = null;
  notify(message);
}

// Runs (or re-runs) the answer for one guide message.
function run(message, forceDemo) {
  const config = configStore.get();
  const useDemo = forceDemo || config.mode === 'demo';
  const turns = history().filter(turn => turn !== message);
  const here = contextPlace();
  const found = retrieval.retrieve(message.question, turns, here === null ? undefined : { contextPlace: here });
  const token = {};
  message.status = 'waiting';
  message.origin = useDemo ? 'demo' : 'live';
  message.error = null;
  message.paras = [];
  message.cites = [];
  message.followups = [];
  message.card = null;
  message.text = '';
  message.raw = '';
  message.places = found.places;
  message.context = here;
  message.grounding = found.chunks.map(chunk => chunk.id);
  state.busy = true;
  notify(message);

  let buffer = '', timer = null, done = false;
  const flush = final => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (active !== token) return;
    applyText(message, buffer, final);
    if (!final) { message.status = 'streaming'; notify(message); }
  };
  const schedule = () => { if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS); };
  const complete = truncated => {
    if (done || active !== token) return;
    flush(true);
    if (!message.text) { fail(provider.failure('empty')); return; }
    done = true;
    message.card = placeCard(found.primaryPlace);
    message.truncated = !!truncated;
    finish(message, 'done');
  };
  const fail = error => {
    if (done || active !== token) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const partial = error.partial || buffer;
    if (partial) applyText(message, partial, false);
    if (error.kind === 'cancelled') {
      message.stopReason = token.reason || 'stopped';
      finish(message, 'stopped');
      return;
    }
    message.error = { kind: error.kind, title: error.title, detail: error.detail, retryable: error.retryable !== false,
      code: error.status ? 'HTTP ' + error.status + (error.code ? ' · ' + error.code : '') : '' };
    finish(message, 'error');
  };

  if (useDemo) {
    // Reveal the locally composed text in small steps so the rhythm matches live mode.
    const full = demo.compose(found);
    let position = 0;
    const step = () => {
      if (active !== token || done) return;
      position = Math.min(full.length, position + 7);
      buffer = full.slice(0, position);
      if (position >= full.length) { complete(false); return; }
      flush(false);
      token.timer = setTimeout(step, 45);
    };
    active = token;
    token.abort = () => { clearTimeout(token.timer); fail(Object.assign(provider.failure('cancelled'), { partial: buffer })); };
    token.timer = setTimeout(step, 320);
    return;
  }
  active = token;
  const handle = provider.chat({
    config,
    messages: prompt.buildMessages(message.question, found, turns, here),
    onDelta(piece, whole) { buffer = whole; schedule(); },
    onDone(result) { buffer = result.text; complete(result.truncated); },
    onError: fail
  }, transport || undefined);
  token.abort = () => handle.abort();
}

function contextPlace() {
  const place = state.context ? state.context.place : null;
  return place === 'village' || places[place] ? place : null;
}
function setContext(context) {
  const place = context ? context.place : null;
  state.context = place === 'village' || places[place] ? { place } : null;
}
function send(text) {
  const question = String(text === undefined ? state.draft : text).trim();
  if (!question) return { ok: false, reason: 'empty' };
  if (state.busy) return { ok: false, reason: 'busy' };
  if (question.length > MAX_QUESTION) return { ok: false, reason: 'long' };
  const user = { id: nextId('u'), role: 'user', text: question };
  const guide = { id: nextId('g'), role: 'guide', question, status: 'waiting', origin: 'demo', paras: [], cites: [], followups: [], card: null, creative: false, error: null, text: '' };
  state.messages.push(user, guide);
  state.draft = '';
  notify(user);
  run(guide, false);
  return { ok: true, id: guide.id };
}
function find(id) { return state.messages.find(message => message.id === id); }
function retry(id, forceDemo) {
  const message = find(id);
  if (!message || message.role !== 'guide' || state.busy) return false;
  if (!['error', 'stopped'].includes(message.status)) return false;
  run(message, !!forceDemo);
  return true;
}
// reason: 'stopped' (visitor pressed stop) or 'interrupted' (page hidden or guide closed).
function stop(reason) {
  if (!active) return false;
  active.reason = reason || 'stopped';
  const abort = active.abort;
  if (abort) abort();
  return true;
}
function reset() {
  stop('interrupted');
  state.messages = [];
  state.draft = '';
  state.busy = false;
  active = null;
}
module.exports = {
  state, send, retry, stop, reset, find, history, placeCard, setContext,
  setDraft(value) { state.draft = String(value || '').slice(0, MAX_QUESTION); },
  subscribe(fn) { listener = fn; },
  unsubscribe(fn) { if (listener === fn) listener = null; },
  mode() { return configStore.get().mode; },
  setTransportForTest(fn) { transport = fn; },
  MAX_QUESTION
};
