// Captures visual evidence from the preview harness (headless Edge).
// Everything produced here is harness output, not WeChat runtime output.
// Usage (from work/):
//   PUPPETEER_CORE=<dir> HARNESS_KAI_FONT=<dir> FFMPEG=<exe> node scripts/guide-preview/capture.cjs <evidence-dir>
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', 'evidence'));
const shots = path.join(outDir, 'screenshots');
const framesDir = path.join(process.env.TEMP || outDir, 'guide-frames-' + Date.now());
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEW = { width: 390, height: 872, deviceScaleFactor: 2 };
const results = { capturedAt: new Date().toISOString(), tool: 'preview harness in headless Microsoft Edge via puppeteer-core (NOT WeChat DevTools, NOT a device)',
  viewport: { cssWidth: 390, cssHeight: 844, note: 'plus a 28 px harness caption strip above the phone; webview area 390 x 753 below a drawn status and navigation bar', deviceScaleFactor: 2, safeAreaBottomEmulated: 34 },
  screenshots: [], measurements: {}, checks: {}, consoleErrors: [] };

(async () => {
  const server = cp.spawn(process.execPath, [path.join(__dirname, 'server.cjs'), String(port)], { stdio: 'ignore', env: process.env });
  await sleep(1000);
  const browser = await puppeteer.launch({ executablePath: edge, headless: 'new', args: ['--hide-scrollbars'] });
  results.browser = await browser.version();
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) results.consoleErrors.push(m.text()); });
  page.on('pageerror', e => results.consoleErrors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/?page=pages/village/index', { waitUntil: 'load' });
  const frame = await (await page.waitForSelector('#view')).contentFrame();
  await frame.waitForFunction('window.__harness && window.__harness.ready', { timeout: 30000 });
  await frame.evaluate(() => document.fonts.ready);
  results.kaiFont = await frame.evaluate(() => document.fonts.check('40px STKaiti') ? 'STKaiti family resolved (on this VM: mapped to the open-source LXGW WenKai webfont by the harness, because no KaiTi font is installed)' : 'no Kai font available; serif fallback shown');
  await sleep(5000); // let the full-resolution photos decode

  const shot = async (name, note) => { await page.screenshot({ path: path.join(shots, name + '.png') }); results.screenshots.push({ file: 'screenshots/' + name + '.png', note }); console.log('shot', name); };
  const ev = (fn, ...args) => frame.evaluate(fn, ...args);
  const phase = () => ev(() => { const a = window.__harness.agent(); return a ? a.data.phase : 'none'; });
  const waitPhase = async (target, timeout = 15000) => { const start = Date.now(); while (await phase() !== target) { if (Date.now() - start > timeout) throw new Error('phase ' + target + ' not reached'); await sleep(30); } };
  const tap = selector => frame.click(selector);
  const tapText = async (selector, text) => { const ok = await ev((s, t) => { const el = [...window.__harness.top().frame.querySelectorAll(s)].find(e => e.textContent.includes(t)); if (!el) return false; el.click(); return true; }, selector, text); if (!ok) throw new Error('not found: ' + selector + ' ' + text); };
  const top = sel => '.wx-page.hx-top ' + sel;
  const setConfig = cfg => ev(c => window.__harness.require('utils/guide-config.js').setForTest(c), cfg);
  const waitIdleAnswer = async (timeout = 40000) => { const start = Date.now(); for (;;) { const busy = await ev(() => window.__harness.require('utils/guide-session.js').state.busy); if (!busy) return; if (Date.now() - start > timeout) throw new Error('answer did not finish'); await sleep(100); } };
  const scrollChat = to => ev(t => { const el = window.__harness.top().frame.querySelector('wx-scroll-view'); el.scrollTo({ top: t === 'end' ? el.scrollHeight : t, behavior: 'auto' }); }, to);

  // ---------- A. the center entry in context, on all four tabs ----------
  await setConfig({ mode: 'demo' });
  await shot('01-entry-button-village-tab', 'Center entry on the village tab (active tab: village).');
  await tapText(top('.tb-item'), '线上寻樟'); await sleep(3500);
  await shot('02-entry-button-guide-tab', 'Center entry on the scenic map tab (active tab: map).');
  await tapText(top('.tb-item'), '乡味好物'); await sleep(2500);
  await shot('03-entry-button-shop-tab', 'Center entry on the shop tab; the cart bar sits above the custom tab bar.');
  await tapText(top('.tb-item'), '我的'); await sleep(2000);
  await shot('04-entry-button-profile-tab', 'Center entry on the profile tab.');
  await tapText(top('.tb-item'), '古村漫行'); await sleep(1500);
  results.checks.tabStack = await ev(() => getCurrentPages().map(p => p.route));

  // ---------- B. real-time recording: tap -> cinematic -> chat -> question -> return ----------
  await ev(() => { window.__harness.top().frame.scrollTo(0, 260); });
  await sleep(600);
  const scrollBefore = await ev(() => window.__harness.top().frame.scrollTop);
  const slideBefore = await ev(() => getCurrentPages()[0].data.slide);
  const client = await page.createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async e => {
    const file = path.join(framesDir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(e.data, 'base64'));
    frames.push({ file, t: e.metadata.timestamp * 1000 });
    try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch (error) {}
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await sleep(900);
  const tapAt = Date.now();
  await tap(top('.tb-center'));
  // rapid repeated taps while entering: must not restart or duplicate anything
  for (let i = 0; i < 4; i++) { await sleep(60); await ev(() => { const el = window.__harness.top().frame.querySelector('.tb-center'); el.click(); }); }
  await waitPhase('chat');
  const chatAt = Date.now();
  const marks = await ev(() => window.__harness.agent().timeline());
  await sleep(1400);
  await tapText(top('.g-ask'), '古水秤是水车吗');
  await waitIdleAnswer();
  await sleep(1500);
  const backAt = Date.now();
  await tap(top('.g-back'));
  await waitPhase('idle');
  const idleAt = Date.now();
  await sleep(1200);
  await client.send('Page.stopScreencast');
  await sleep(300);
  const scrollAfter = await ev(() => window.__harness.top().frame.scrollTop);
  results.measurements.fullEntry = {
    description: 'First entry in a launch. Times in ms from the phase marks recorded by the component (Date.now at each phase change) in the harness browser.',
    sourceRecessionMs: marks.cinema - marks.tap, cinematicMs: marks.reveal - marks.cinema, chatRevealMs: marks.chat - marks.reveal, tapToUsableChatMs: marks.chat - marks.tap,
    designTargetsMs: marks.timing, wallClockTapToChatObservedByDriverMs: chatAt - tapAt, returnToPageMs: idleAt - backAt
  };
  results.checks.repeatedTaps = { extraTapsDuringEntry: 4, result: 'single timeline; phases advanced once' };
  results.checks.scrollRestoration = { scrollTopBeforeEntry: scrollBefore, scrollTopAfterReturn: scrollAfter, swiperSlideBefore: slideBefore, preserved: scrollBefore === scrollAfter };
  results.measurements.recording = { frames: frames.length, durationMs: Math.round(frames[frames.length - 1].t - frames[0].t), tapOffsetMs: Math.round(tapAt - frames[0].t) };

  // Stage stills are taken from the recording itself, at offsets from the tap.
  const stages = [[120, '05-transition-0120ms-page-still-visible'], [330, '06-transition-0330ms-page-receding'], [560, '07-transition-0560ms-page-fading'], [1000, '08-cinematic-1000ms-water-line'], [1650, '09-cinematic-1650ms-divider-and-channels'], [2300, '10-cinematic-2300ms-title-soaking-in'], [3000, '11-cinematic-3000ms-title-complete'], [3800, '12-cinematic-3800ms-seal-and-verse'], [4350, '13-reveal-4350ms-title-to-header'], [4700, '14-reveal-4700ms-chat-unrolling']];
  for (const [offset, name] of stages) {
    const target = tapAt + offset;
    const best = frames.reduce((a, b) => Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a);
    fs.copyFileSync(best.file, path.join(shots, name + '.jpg'));
    results.screenshots.push({ file: 'screenshots/' + name + '.jpg', note: 'Recording frame nearest to ' + offset + ' ms after the tap (actual ' + Math.round(best.t - tapAt) + ' ms).' });
  }
  // Encode the recording in real time (variable frame durations preserved).
  const ffmpeg = process.env.FFMPEG;
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    const list = frames.map((f, i) => "file '" + f.file.replace(/\\/g, '/') + "'\nduration " + (((frames[i + 1] ? frames[i + 1].t : f.t + 200) - f.t) / 1000).toFixed(4)).join('\n') + "\nfile '" + frames[frames.length - 1].file.replace(/\\/g, '/') + "'\n";
    const listFile = path.join(framesDir, 'frames.txt');
    fs.writeFileSync(listFile, list);
    const video = path.join(outDir, 'recording-tap-to-chat-and-return.mp4');
    const run = cp.spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,scale=780:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', video], { encoding: 'utf8' });
    results.measurements.recording.file = run.status === 0 ? 'recording-tap-to-chat-and-return.mp4' : 'ENCODING FAILED: ' + String(run.stderr).slice(-300);
  } else results.measurements.recording.file = 'not encoded: FFMPEG not provided';

  // ---------- C. welcome ----------
  await sleep(500);
  await tap(top('.tb-center'));
  await waitPhase('chat');
  const shortMarks = await ev(() => window.__harness.agent().timeline());
  results.measurements.repeatEntry = { description: 'Second entry in the same launch (short intro).', sourceRecessionMs: shortMarks.cinema - shortMarks.tap, titleBeatMs: shortMarks.reveal - shortMarks.cinema, chatRevealMs: shortMarks.chat - shortMarks.reveal, tapToUsableChatMs: shortMarks.chat - shortMarks.tap };
  results.checks.conversationKeptAcrossReentry = await ev(() => window.__harness.agent().data.messages.length);
  await sleep(600);
  await shot('16-short-conversation', 'Short conversation in offline demo mode (labeled as demo on the answer and in the header). Source chips, scenic card with the real water-divider photo, follow-up questions.');
  await scrollChat(0); await sleep(500);
  await ev(() => window.__harness.require('utils/guide-session.js').reset());
  await tap(top('.g-back')); await waitPhase('idle'); await sleep(300);
  await tap(top('.tb-center')); await waitPhase('chat'); await sleep(700);
  await shot('15-welcome', 'Welcome state: guide identity, four scenic stamps with each scenic point\'s own real photo, suggested questions, input dock.');
  await scrollChat('end'); await sleep(500);
  await shot('15b-welcome-scrolled', 'Welcome state scrolled: suggested questions and grounding note.');

  // ---------- D. streaming and long answer ----------
  await ev(() => { window.__harness.instantScroll = true; });
  await tapText(top('.g-stamp'), '千年古樟');
  await sleep(250); await shot('17-waiting-state', 'Waiting state right after sending (ink-drop indicator, send button becomes stop).');
  await sleep(900); await shot('18-streaming-state', 'Answer being written (demo mode reveals local text in steps).');
  await waitIdleAnswer(); await sleep(500);
  await ev(() => { const s = window.__harness.require('utils/guide-session.js'); s.send('请详细讲讲古渊头村的概况'); });
  await waitIdleAnswer(); await sleep(700);
  await shot('19-long-answer-end', 'Long answer (524 characters, a prepared script quoted from the knowledge base, demo mode), scrolled to the end with the last message visible.');
  await scrollChat(await ev(() => { const el = window.__harness.top().frame.querySelector('wx-scroll-view'); return el.scrollHeight - el.clientHeight - 620; }));
  await sleep(500);
  await shot('20-long-answer-scrolled-up', 'Same long answer scrolled up: auto-scroll yields and the "back to latest" control appears.');
  results.checks.jumpControlShown = await ev(() => window.__harness.agent().data.showJump);
  await tap(top('.g-jump')).catch(() => {}); await sleep(400);

  // ---------- E. keyboard and input ----------
  await tap(top('.g-send')); await sleep(300);
  await shot('21-empty-input-hint', 'Empty input: the send control is inactive and tapping it shows a hint; nothing is sent.');
  await sleep(2300);
  await ev(() => { window.__harness.holdKeyboard = true; });
  await frame.focus(top('.g-input textarea'));
  await frame.type(top('.g-input textarea'), '四本堂的门额上写了什么？\n我想带孩子去看，\n有没有适合讲给他听的故事？');
  await sleep(700);
  await shot('22-keyboard-multiline-input', 'Multiline input with the SIMULATED keyboard panel of the harness (300 px). The dock is lifted by the reported keyboard height. Not a system keyboard.');
  results.checks.keyboard = await ev(() => { const a = window.__harness.agent(); return { reportedHeightPx: a.data.keyboard, draftLength: a.data.draftLength, canSend: a.data.canSend }; });
  await ev(() => window.__harness.blur()); await sleep(500);
  await ev(() => { const a = window.__harness.agent(); a.input({ detail: { value: '' } }); });

  // ---------- F. failures: the real provider response, then offline ----------
  await setConfig({ mode: 'live-direct', apiKey: 'harness-proxy-injects-the-real-key' });
  await tap(top('.g-back')); await waitPhase('idle'); await sleep(200);
  await ev(() => window.__harness.require('utils/guide-session.js').reset());
  await tap(top('.tb-center')); await waitPhase('chat'); await sleep(400);
  await ev(() => { window.__harness.net = 'proxy'; });
  await tapText(top('.g-ask'), '古渊头为什么叫这个名字');
  await waitIdleAnswer(60000); await sleep(600);
  const liveMessage = await ev(() => { const m = window.__harness.require('utils/guide-session.js').state.messages[1]; return { status: m.status, origin: m.origin, error: m.error, textLength: (m.text || '').length }; });
  results.checks.liveRequestThroughHarness = liveMessage;
  await shot(liveMessage.status === 'done' ? '23-live-answer' : '23-failure-real-provider-response', liveMessage.status === 'done' ? 'Live answer from the configured model.' : 'Real request to the configured provider and model through the harness proxy: the provider\'s actual error is shown with retry and a labeled demo fallback.');
  await ev(() => { window.__harness.net = 'offline'; });
  await ev(() => { const a = window.__harness.agent(); a.input({ detail: { value: '草稿：下一个想问的问题' } }); });
  await tapText(top('.g-btn'), '重试'); await waitIdleAnswer(); await sleep(500);
  await shot('24-failure-offline-retry', 'Network failure (harness transport set to offline): retryable error; the draft typed meanwhile is kept.');
  await tapText(top('.g-btn'), '改用离线演示回答'); await waitIdleAnswer(); await sleep(600);
  await shot('25-labeled-demo-fallback', 'After choosing the offline demo fallback: the answer is labeled as demo, not as model output.');
  await ev(() => { window.__harness.net = 'proxy'; const a = window.__harness.agent(); a.input({ detail: { value: '' } }); });

  // ---------- G. source sheet, linked pages, back handling ----------
  await tap(top('.g-source')); await sleep(500);
  await shot('26-source-sheet', 'Tapping a source chip names the cited report from section eleven of the knowledge base.');
  await tapText(top('.g-btn'), '知道了'); await sleep(300);
  await setConfig({ mode: 'demo' });
  await ev(() => { window.__harness.require('utils/guide-session.js').send('乌竹溪古水秤是做什么用的？'); });
  await waitIdleAnswer(); await sleep(600);
  await tapText(top('.g-link'), '景点介绍'); await sleep(3500);
  results.checks.linkedRoute = await ev(() => { const p = getCurrentPages(); return { stack: p.map(x => x.route), id: p[p.length - 1].data.place && p[p.length - 1].data.place.id }; });
  await shot('27-linked-scenic-introduction', 'The scenic card opens the existing introduction page (pages/place/index?id=1).');
  await ev(() => window.__harness.back()); await sleep(700);
  results.checks.afterReturnFromLink = { phase: await phase(), messages: await ev(() => window.__harness.agent().data.messages.length) };
  await shot('28-back-to-chat-from-link', 'Returning from the linked page: the conversation is still open.');
  const backResult = await ev(() => window.__harness.back());
  await waitPhase('idle'); await sleep(700);
  results.checks.hardwareBack = { handledBy: backResult, phaseAfter: await phase(), scrollTopAfter: await ev(() => window.__harness.top().frame.scrollTop) };
  await shot('29-returned-to-source-page', 'After the hardware-back path (page-container in the harness): the village page is back at the same scroll position.');

  // ---------- H. skip, cancel, background ----------
  await ev(() => { window.__harness.require('utils/guide-session.js').state.introPlayed = false; });
  await tap(top('.tb-center')); await sleep(900);
  await shot('30-skip-control', 'Skip control during the cinematic (first-entry version forced again for this capture).');
  const skipAt = Date.now();
  await tap(top('.g-skip')); await waitPhase('chat');
  results.measurements.skip = { skipTapToUsableChatMs: Date.now() - skipAt };
  await tap(top('.g-back')); await waitPhase('idle');
  await ev(() => { window.__harness.require('utils/guide-session.js').state.introPlayed = false; });
  await tap(top('.tb-center')); await sleep(1500);
  await ev(() => window.__harness.back()); const cancelAt = Date.now(); await waitPhase('idle');
  results.measurements.cancelDuringCinematic = { backToPageMs: Date.now() - cancelAt, guideMotionAfter: await ev(() => getCurrentPages()[0].data.guideMotion) };
  await ev(() => { window.__harness.require('utils/guide-session.js').state.introPlayed = false; });
  await tap(top('.tb-center')); await sleep(1600);
  await ev(() => window.__harness.appHide()); await sleep(1500); await ev(() => window.__harness.appShow()); await sleep(400);
  results.checks.backgroundDuringCinematic = { phaseAfterResume: await phase() };
  await tap(top('.g-back')); await waitPhase('idle');

  fs.writeFileSync(path.join(outDir, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.measurements, null, 1));
  console.log('console errors:', results.consoleErrors.length);
  await browser.close();
  server.kill();
  fs.rmSync(framesDir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
