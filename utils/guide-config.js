// Guide provider configuration.
// Defaults are safe (offline demo, no credential). Local overrides come from
// utils/guide-config.local.js, which scripts/configure-guide.cjs generates from
// api-config/.env.local. See deliverables/IMPLEMENTATION_REPORT.md.
//
// mode:
//   'demo'        offline answers composed from the knowledge base, labeled as demo
//   'live-direct' development only: the mini-program calls the provider with a key
//   'live-relay'  the mini-program calls your relay; the key stays on the server
const defaults = {
  mode: 'demo',
  provider: 'CherryIN',
  baseUrl: 'https://open.cherryin.net/v1',
  protocol: 'chat_completions',
  model: 'agent/qwen3-coder-30b-a3b-instruct(free)',
  apiKey: '',
  relayUrl: '',
  stream: true,
  timeoutMs: 60000,
  firstByteTimeoutMs: 25000,
  temperature: 0.3,
  maxTokens: 900,
  // Uses <page-container> to turn the hardware/gesture back into "close guide". The
  // container is mounted only while a guide layer is open (see utils/guide-back.js).
  // Set false if a device shows a problem with it; the in-layer back button stays.
  backCapture: true,
  // Locks the tab page behind the layer with <page-meta page-style="overflow:hidden">.
  lockPageScroll: true,
  // true renders the layer through <root-portal> (base library 2.25.2+), outside the
  // custom tab bar subtree. Only needed if a device clips or mis-stacks the layer.
  layerPortal: false
};
let overrides = {};
try { overrides = require('./guide-config.local') || {}; } catch (error) { overrides = {}; }
let testOverrides = null;
function get() {
  const config = Object.assign({}, defaults, overrides, testOverrides || {});
  if (config.mode === 'live-direct' && !config.apiKey) config.mode = 'demo';
  if (config.mode === 'live-relay' && !config.relayUrl) config.mode = 'demo';
  if (!['demo', 'live-direct', 'live-relay'].includes(config.mode)) config.mode = 'demo';
  return config;
}
module.exports = { get, defaults, isLive: () => get().mode !== 'demo', setForTest(value) { testOverrides = value; } };
