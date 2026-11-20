// Quick harness smoke test: loads one tab, prints console errors, saves a screenshot.
// Usage: PUPPETEER_CORE=<path to puppeteer-core> node scripts/guide-preview/smoke.cjs [route] [out.png]
const path = require('node:path');
const cp = require('node:child_process');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 4173 + Math.floor(Math.random() * 500);
const route = process.argv[2] || 'pages/village/index';
const out = process.argv[3] || path.join(process.env.TEMP || '.', 'guide-smoke.png');
(async () => {
  const server = cp.spawn(process.execPath, [path.join(__dirname, 'server.cjs'), String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const browser = await puppeteer.launch({ executablePath: edge, headless: 'new', args: ['--hide-scrollbars', '--force-device-scale-factor=2'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 872, deviceScaleFactor: 2 });
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('[' + m.type() + ']', m.text()); });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto('http://127.0.0.1:' + port + '/?page=' + route, { waitUntil: 'load' });
    const frame = await (await page.waitForSelector('#view')).contentFrame();
    await frame.waitForFunction('window.__harness && window.__harness.ready', { timeout: 20000 });
    await new Promise(r => setTimeout(r, Number(process.argv[4] || 2500)));
    console.log('pages:', await frame.evaluate(() => getCurrentPages().map(p => p.route).join(',')));
    await page.screenshot({ path: out });
    console.log('saved', out);
  } finally { await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
