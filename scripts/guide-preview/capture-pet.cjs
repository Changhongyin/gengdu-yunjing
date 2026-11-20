// Captures visual evidence of the floating companion from the preview harness
// (headless Edge). Everything produced here is BROWSER-HARNESS output: it is not
// WeChat DevTools and not a device. Gestures are real pointer input from the
// driver (mouse down / move / up), translated to touch events by the harness.
// The guide runs in offline demo mode: this script sends no provider request.
// Usage:
//   PUPPETEER_CORE=<dir> HARNESS_KAI_FONT=<dir> FFMPEG=<exe> node scripts/guide-preview/capture-pet.cjs <evidence-dir>
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', 'Claude_Pet_Handoff', 'evidence'));
const shots = path.join(outDir, 'browser-harness-screenshots');
const framesDir = path.join(process.env.TEMP || outDir, 'pet-frames-' + Date.now());
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });
const port = 4300 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEW = { width: 390, height: 872, deviceScaleFactor: 2 };
const results = { capturedAt: new Date().toISOString(),
  tool: 'BROWSER HARNESS: scripts/guide-preview in headless Microsoft Edge via puppeteer-core. NOT WeChat DevTools, NOT a device.',
  viewport: { cssWidth: 390, cssHeight: 844, note: '28 px harness caption strip above the phone; webview area 390 x 753 below a drawn status and navigation bar', deviceScaleFactor: 2, safeAreaBottomEmulated: 34 },
  guideMode: 'offline demo (no provider request is sent by this script)', screenshots: [], measurements: {}, checks: {}, consoleErrors: [] };

(async () => {
  const server = cp.spawn(process.execPath, [path.join(__dirname, 'server.cjs'), String(port)], { stdio: 'ignore', env: process.env });
  await sleep(1000);
  const browser = await puppeteer.launch({ executablePath: edge, headless: 'new', args: ['--hide-scrollbars'] });
  results.browser = await browser.version();
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) results.consoleErrors.push(m.text()); });
  page.on('pageerror', e => results.consoleErrors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/?page=pages/guide/index', { waitUntil: 'load' });
  const frameHandle = await page.waitForSelector('#view');
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction('window.__harness && window.__harness.ready', { timeout: 30000 });
  await frame.evaluate(() => document.fonts.ready);
  const origin = await frameHandle.boundingBox();
  const ev = (fn, ...args) => frame.evaluate(fn, ...args);
  await ev(() => window.__harness.require('utils/guide-config.js').setForTest({ mode: 'demo' }));
  // A visible finger mark for the recording (harness only).
  await ev(() => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(173,136,73,.28);border:2px solid rgba(173,136,73,.9);z-index:99999;pointer-events:none;display:none';
    document.body.appendChild(dot);
    const at = e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; };
    document.addEventListener('pointerdown', e => { at(e); dot.style.display = 'block'; }, true);
    document.addEventListener('pointermove', at, true);
    document.addEventListener('pointerup', () => { dot.style.display = 'none'; }, true);
  });

  const shot = async (name, note) => { await page.screenshot({ path: path.join(shots, name + '.png') }); results.screenshots.push({ file: 'browser-harness-screenshots/' + name + '.png', note }); console.log('shot', name); };
  const top = sel => '.wx-page.hx-top ' + sel;
  const tapText = async (selector, text) => { const ok = await ev((s, t) => { const el = [...window.__harness.top().frame.querySelectorAll(s)].find(e => e.textContent.includes(t)); if (!el) return false; el.click(); return true; }, selector, text); if (!ok) throw new Error('not found: ' + selector + ' ' + text); };
  const route = () => ev(() => getCurrentPages().map(p => p.route));
  const pet = () => ev(() => { const p = window.__harness.pet(); if (!p) return null; const d = p.data; return { visible: d.visible, away: d.away, minimized: d.minimized, side: d.side, x: d.x, y: d.y, w: d.w, h: d.h, pose: d.pose, anim: d.anim, mode: d.mode, bubble: d.bubble ? { kind: d.bubble.kind, title: d.bubble.title, text: d.bubble.text, source: d.bubble.source, done: d.bubble.done } : null }; });
  const petNodes = () => ev(() => window.__harness.top().frame.querySelectorAll('wx-village-pet, .vp, .vp-body, .vp-bubble').length);
  const phase = () => ev(() => { const a = window.__harness.agent(); return a ? a.data.phase : 'none'; });
  const waitPhase = async (target, timeout = 15000) => { const start = Date.now(); while (await phase() !== target) { if (Date.now() - start > timeout) throw new Error('phase ' + target + ' not reached'); await sleep(30); } };
  const waitBubble = async (kind, timeout = 8000) => { const start = Date.now(); for (;;) { const p = await pet(); if (p && p.bubble && p.bubble.kind === kind && p.bubble.done) return p; if (Date.now() - start > timeout) throw new Error('bubble ' + kind + ' not shown'); await sleep(40); } };
  const waitIdleAnswer = async (timeout = 40000) => { const start = Date.now(); for (;;) { const busy = await ev(() => window.__harness.require('utils/guide-session.js').state.busy); if (!busy) return; if (Date.now() - start > timeout) throw new Error('answer did not finish'); await sleep(100); } };
  const petCenter = async () => { const p = await pet(); return { x: origin.x + p.x + p.w / 2, y: origin.y + p.y + p.h * 0.55 }; };
  const tapPet = async () => { const c = await petCenter(); await page.mouse.move(c.x, c.y); await page.mouse.down(); await sleep(70); await page.mouse.up(); };
  const pressPet = async ms => { const c = await petCenter(); await page.mouse.move(c.x, c.y); await page.mouse.down(); await sleep(ms); };
  const closeBubble = () => ev(() => { const p = window.__harness.pet(); if (p && p.data.bubble) p.hush(); });
  const store = fn => ev(fn);

  // ---------- A. tourism tabs: one companion; commerce and profile: none ----------
  await waitBubble('intro');
  await shot('01-map-tab-greeting', 'Scenic map tab: the companion (supplied character, scroll pose) greets once per launch; the first bubble carries the gesture hint.');
  results.checks.mapTab = { pet: await pet(), petElements: await petNodes() };
  await tapText(top('.tb-item'), '古村漫行'); await waitBubble('intro');
  await shot('02-village-tab-village-introduction', 'Village tab: proactive village overview (local source-grounded text, labeled as not model-generated).');
  results.checks.villageTab = { pet: await pet() };
  await tapText(top('.tb-item'), '乡味好物'); await sleep(2500);
  await shot('03-shop-tab-no-companion', 'Shop tab: no companion, no bubble.');
  results.checks.shopTab = { route: await route(), petElements: await petNodes() };
  await ev(() => getCurrentPages()[0].openProduct({ currentTarget: { dataset: { id: 'vegetable' } } })); await sleep(1500);
  await shot('04-product-page-no-companion', 'Product page: no companion.');
  results.checks.product = { route: await route(), petElements: await petNodes() };
  await ev(() => wx.navigateTo({ url: '/pages/checkout/index' })); await sleep(1500);
  await shot('05-checkout-page-no-companion', 'Checkout page: no companion.');
  results.checks.checkout = { route: await route(), petElements: await petNodes() };
  await ev(() => { window.__harness.back(); window.__harness.back(); }); await sleep(400);
  await tapText(top('.tb-item'), '我的'); await sleep(2000);
  await shot('06-profile-tab-no-companion', 'Profile tab: no companion.');
  results.checks.profileTab = { route: await route(), petElements: await petNodes() };
  results.checks.timersOnExcludedPage = await ev(() => { const pages = Object.values(window.__harness.require('utils/pet-controller.js').state.introAt).length; return { introducedTopicsSoFar: pages }; });

  // ---------- B. real-time recording: camphor panorama -> tap -> switch -> drag -> long press -> chat -> return ----------
  await tapText(top('.tb-item'), '线上寻樟'); await sleep(1500);
  const client = await page.createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async e => {
    const file = path.join(framesDir, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(e.data, 'base64'));
    frames.push({ file, t: e.metadata.timestamp * 1000 });
    try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch (error) {}
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 86, everyNthFrame: 1 });
  await sleep(800);
  const marks = {};
  const mark = name => { marks[name] = Date.now(); };
  mark('start');
  // enter the camphor panorama: nobody touches the companion
  await tapText(top('.primary'), '前往全景漫游'); mark('enterPanorama');
  const camphor = await waitBubble('intro'); mark('camphorIntroComplete');
  results.checks.camphorIntroduction = { route: await route(), bubble: camphor.bubble, pose: camphor.pose, requests: await ev(() => window.__harness.requests.length) };
  await sleep(1500);
  await shot('07-panorama-camphor-proactive-introduction', 'Camphor panorama (id=0): the companion introduced the camphor without being touched; age given with source and date; no request was sent.');
  await sleep(1200);
  // single tap
  await tapPet(); mark('tap');
  const reaction = await waitBubble('react');
  results.checks.singleTap = { bubble: reaction.bubble, pose: reaction.pose, guidePhase: await phase() };
  await sleep(700);
  await shot('08-single-tap-reaction', 'Single tap: one short reaction bubble with replay, an explicit chat action and minimize; the chat stays closed.');
  await sleep(1300);
  // switch to the water divider
  await ev(() => window.__harness.top().frame.scrollTo({ top: 520, behavior: 'smooth' })); await sleep(900);
  await tapText(top('.scene-tab'), '乌竹溪古水秤'); mark('switchScene');
  const water = await waitBubble('intro'); mark('waterIntroComplete');
  results.checks.switchedIntroduction = { sceneId: await ev(() => getCurrentPages().pop().data.scene.id), bubble: water.bubble };
  await sleep(1500);
  await shot('09-switch-to-water-divider-introduction', 'After switching the scene to id=1 the introduction is about the water divider (a dividing stone, not a water wheel).');
  await sleep(1000);
  // drag to the other side
  const before = await pet();
  const c = await petCenter();
  await page.mouse.move(c.x, c.y); await page.mouse.down(); mark('dragStart');
  for (let i = 1; i <= 24; i++) { await page.mouse.move(c.x - i * 9.5, c.y - i * 7); await sleep(22); if (i === 12) await shot('10-dragging-in-progress', 'Dragging: the companion follows the finger; its bubble is withdrawn; no tap and no chat.'); }
  await sleep(500); // holding still at the end of a drag is not a long press
  await page.mouse.up(); mark('dragEnd');
  await sleep(600);
  const after = await pet();
  results.checks.drag = { before: { side: before.side, x: before.x, y: before.y }, after: { side: after.side, x: after.x, y: after.y }, bubbleAfter: after.bubble, guidePhaseAfter: await phase(), saved: await ev(() => wx.getStorageSync('guyuan-pet-v1')) };
  await shot('11-after-drag-snapped-left', 'After release the companion snaps to the nearer (left) side; position is saved under the new key guyuan-pet-v1.');
  await sleep(700);
  // long press -> the existing guide conversation
  await ev(() => window.__harness.top().frame.scrollTo({ top: 140 })); await sleep(500);
  const scrollBeforeChat = await ev(() => window.__harness.top().frame.scrollTop);
  const pressAt = Date.now();
  await pressPet(260);
  await shot('12-long-press-in-progress', 'Long press in progress (about 260 ms): the ring under the character fills during the 420 ms recognition window.');
  const waitOpen = Date.now();
  while (await phase() === 'idle') { if (Date.now() - waitOpen > 3000) throw new Error('long press did not open the chat'); await sleep(8); }
  mark('chatOpening');
  results.measurements.longPress = { thresholdMs: 420, pressToLayerOpenObservedByDriverMs: Date.now() - pressAt, note: 'driver-side wall clock including screenshot time and polling; the threshold itself is asserted in scripts/check-pet.cjs with a virtual clock' };
  await sleep(1500); // keep holding: an extended hold
  await page.mouse.up(); mark('release');
  await waitPhase('chat'); mark('chatReady');
  const afterRelease = await pet();
  results.checks.longPress = { opens: await ev(() => window.__harness.pet()._opens), bubbleAfterRelease: afterRelease.bubble, companionHidden: afterRelease.away, context: await ev(() => window.__harness.require('utils/guide-session.js').state.context), contextName: await ev(() => window.__harness.agent().data.contextName), firstEntryCinematic: await ev(() => !window.__harness.agent().data.short), navTitle: await page.$eval('#title', el => el.textContent) };
  await sleep(900);
  await shot('13-chat-opened-by-long-press', 'The existing guide conversation, opened by the long press from the panorama, with the scenic context strip (you are at: water divider).');
  await tapText(top('.g-context-ask'), '讲讲这里');
  await waitIdleAnswer(); await sleep(1200); mark('answered');
  results.checks.contextAnswer = await ev(() => { const m = window.__harness.require('utils/guide-session.js').state.messages; const g = m[m.length - 1]; return { question: g.question, status: g.status, origin: g.origin, places: g.places, card: g.card && g.card.name, cites: g.cites.map(c => c.id) }; });
  await shot('14-context-answer-offline-demo', 'Answer for the current scene from the existing knowledge path (offline demo: quotes the knowledge base, labeled as demo, not model output).');
  await sleep(800);
  await ev(() => window.__harness.top().frame.querySelector('.g-back').click()); mark('close');
  await waitPhase('idle'); await sleep(1500); mark('returned');
  const back = await pet();
  results.checks.returnFromChat = { scrollTopBeforeChat: scrollBeforeChat, route: await route(), sceneId: await ev(() => getCurrentPages().pop().data.scene.id), scrollTop: await ev(() => window.__harness.top().frame.scrollTop), companion: { away: back.away, side: back.side, x: back.x, y: back.y }, navTitle: await page.$eval('#title', el => el.textContent) };
  await shot('15-returned-from-chat', 'Back on the same panorama scene after closing the chat: same scroll position, same companion position, real page title.');
  await sleep(600);
  await client.send('Page.stopScreencast'); await sleep(300);
  results.measurements.recording = { frames: frames.length, durationMs: Math.round(frames[frames.length - 1].t - frames[0].t), marksMsFromStart: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v - marks.start])) };
  const ffmpeg = process.env.FFMPEG;
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    const list = frames.map((f, i) => "file '" + f.file.replace(/\\/g, '/') + "'\nduration " + (((frames[i + 1] ? frames[i + 1].t : f.t + 200) - f.t) / 1000).toFixed(4)).join('\n') + "\nfile '" + frames[frames.length - 1].file.replace(/\\/g, '/') + "'\n";
    const listFile = path.join(framesDir, 'frames.txt');
    fs.writeFileSync(listFile, list);
    const video = path.join(outDir, 'browser-harness-recording-companion.mp4');
    const run = cp.spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,scale=780:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', video], { encoding: 'utf8' });
    results.measurements.recording.file = run.status === 0 ? 'browser-harness-recording-companion.mp4' : 'ENCODING FAILED: ' + String(run.stderr).slice(-300);
  } else results.measurements.recording.file = 'not encoded: FFMPEG not provided';

  // ---------- C. locked scene, the other scenic points ----------
  await closeBubble();
  await ev(() => getCurrentPages().pop().select(3)); await sleep(2500);
  results.checks.lockedScene = { sceneIdAfter: await ev(() => getCurrentPages().pop().data.scene.id), contextTopic: await ev(() => window.__harness.require('utils/pet-controller.js').context(getCurrentPages().pop()).topic), bubble: (await pet()).bubble };
  await shot('16-locked-scene-no-introduction', 'Selecting the locked fourth scene is rejected by the existing rule (toast); the companion says nothing about it.');
  await ev(() => getCurrentPages().pop().select(2));
  const chengqi = await waitBubble('intro'); await sleep(600);
  results.checks.chengqi = { bubble: chengqi.bubble };
  await ev(() => window.__harness.top().frame.scrollTo({ top: 0 })); await sleep(500);
  await shot('17-chengqi-hall-introduction', 'Chengqi Hall (id=2): its own introduction, based on the photographed on-site sign.');
  await closeBubble();
  await ev(() => { const s = window.__harness.require('utils/store.js'); s.collect(1); s.collect(2); getCurrentPages().pop().refresh(); getCurrentPages().pop().select(3); });
  const siben = await waitBubble('intro'); await sleep(600);
  results.checks.siben = { bubble: siben.bubble };
  await shot('18-siben-hall-introduction', 'Siben Hall (id=3, after unlocking): current name and education context.');

  // ---------- D. detail, route, cards, gallery, postcard ----------
  await closeBubble();
  await ev(() => wx.navigateTo({ url: '/pages/place/index?id=2' })); await sleep(3500);
  results.checks.placePage = { route: await route(), pet: await pet(), why: await ev(() => window.__harness.pet()._decision) };
  await tapPet(); await waitBubble('react'); await sleep(500);
  await shot('19-scenic-introduction-page-tap', 'Scenic introduction page (Chengqi Hall): the same companion, same side; within the cooldown it does not repeat the introduction, and a tap offers replay.');
  await ev(() => window.__harness.pet().tapAction({ currentTarget: { dataset: { id: 'intro' } } })); await waitBubble('intro'); await sleep(400);
  await shot('20-replay-on-request', 'Replay on request (the bubble action).');
  await closeBubble();
  await ev(() => wx.navigateTo({ url: '/pages/visit/index?id=2' })); await waitBubble('intro'); await sleep(500);
  results.checks.routePage = { pet: await pet() };
  await shot('21-virtual-route-note', 'Virtual route page: the companion states that this is a demonstration, not real navigation.');
  await ev(() => { window.__harness.back(); window.__harness.back(); }); await sleep(300);
  await ev(() => wx.navigateTo({ url: '/pages/cards/index' })); await sleep(3000);
  results.checks.cardsPage = { pet: await pet(), why: await ev(() => window.__harness.pet()._decision) };
  await shot('22-cards-page-quiet', 'Card collection: quiet reading pose, no unsolicited bubble.');
  await ev(() => window.__harness.back()); await sleep(300);
  await ev(() => wx.navigateTo({ url: '/pages/gallery/index?id=0&index=0' })); await sleep(5000);
  results.checks.galleryPage = { pet: await pet(), why: await ev(() => window.__harness.pet()._decision), toolbarTop: await ev(() => window.__harness.top().frame.querySelector('.gallery-footer').getBoundingClientRect().top) };
  await shot('23-gallery-compact-quiet', 'Photo gallery: compact, quiet, above the caption and zoom controls.');
  await ev(() => window.__harness.back()); await sleep(300);
  // collect a postcard on the water divider scene -> celebration on the postcard page
  await ev(() => { const s = window.__harness.require('utils/store.js'); s.save({ collected: [0, 2] }); const p = getCurrentPages().pop(); p.select(1); p.refresh(); });
  await sleep(600); await closeBubble();
  await ev(() => { const p = getCurrentPages().pop(); p.task(); }); await sleep(500);
  await ev(() => { const p = getCurrentPages().pop(); p.answer({ currentTarget: { dataset: { index: 1 } } }); });
  const party = await waitBubble('celebrate'); await sleep(350);
  results.checks.celebration = { route: await route(), pose: party.pose, bubble: party.bubble };
  await shot('24-postcard-celebration', 'A newly collected postcard: one short celebration (celebration pose).');
  await ev(() => window.__harness.back()); await sleep(400);

  // ---------- E. minimize, restore ----------
  await closeBubble(); await tapPet(); await waitBubble('react');
  await ev(() => window.__harness.pet().tapAction({ currentTarget: { dataset: { id: 'min' } } })); await sleep(600);
  results.checks.minimized = { pet: await pet() };
  await shot('25-minimized-edge-tab', 'Minimized: a small tab at the screen edge; nothing else stays on the page.');
  const tab = await pet();
  await page.mouse.click(origin.x + tab.x + tab.w / 2, origin.y + tab.y + tab.h / 2); await waitBubble('react'); await sleep(300);
  results.checks.restored = { pet: await pet() };
  await shot('26-restored', 'Tapping the tab restores the companion.');

  // ---------- F. long press from a detail page keeps the same conversation ----------
  await closeBubble();
  await ev(() => wx.navigateTo({ url: '/pages/place/index?id=0' })); await sleep(2500); await closeBubble();
  await pressPet(700); await page.mouse.up(); await waitPhase('chat'); await sleep(700);
  results.checks.detailPageChat = { route: await route(), shortOpening: await ev(() => window.__harness.agent().data.short), messages: await ev(() => window.__harness.agent().data.messages.length), context: await ev(() => window.__harness.require('utils/guide-session.js').state.context), navTitle: await page.$eval('#title', el => el.textContent) };
  await shot('27-detail-page-long-press-same-conversation', 'Long press on the camphor introduction page: the same conversation (earlier messages kept), camphor context, short repeat opening.');
  await ev(() => window.__harness.back()); await waitPhase('idle'); await sleep(500);
  results.checks.detailPageAfterBack = { route: await route(), navTitle: await page.$eval('#title', el => el.textContent), companionAway: (await pet()).away };
  results.checks.totalProviderRequests = await ev(() => window.__harness.requests.length);

  // ---------- G. regression for the native fix round: layering over photos, sheets, back-catcher count ----------
  // Browser (Chromium) hit tests and DOM counts. They show the authored layer order and the
  // mount lifecycle; they do NOT show WeChat's native compositing or its page-container.
  const containers = () => ev(() => ({ mounted: document.querySelectorAll('wx-page-container').length, shown: [...document.querySelectorAll('wx-page-container')].filter(el => el.__shown).length }));
  const placePet = (side, ratio) => ev((s, r) => { const c = window.__harness.require('utils/pet-controller.js'); c.setPosition(s, r); const p = window.__harness.pet(); p.hush(); p.setData(p.layout()); }, side, ratio);
  const hit = () => ev(() => {
    const p = window.__harness.pet(), d = p.data, box = window.__harness.top().frame.querySelector('.vp');
    const style = getComputedStyle(box);
    const at = [[.5, .3], [.5, .6], [.35, .82]].map(([fx, fy]) => document.elementFromPoint(d.x + d.w * fx, d.y + d.h * fy));
    box.style.visibility = 'hidden';
    const under = document.elementFromPoint(d.x + d.w * .5, d.y + d.h * .5);
    box.style.visibility = '';
    const bubble = box.querySelector('.vp-bubble');
    let bubbleOnTop = null;
    if (bubble) { const r = bubble.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); bubbleOnTop = !!(e && e.closest('.vp-bubble')); }
    return { companionOnTop: at.every(e => !!(e && e.closest('.vp'))), bubbleOnTop, elementUnderneath: under ? under.tagName.toLowerCase() + (under.className ? '.' + String(under.className).split(' ')[0] : '') : null,
      zIndex: style.zIndex, opacity: style.opacity, pointerEvents: style.pointerEvents, insideRootPortal: !!box.closest('wx-root-portal'), portalEnabled: p.data.portal };
  });
  const layering = results.checks.layering = {};
  // place page: over the hero swiper, with a bubble
  await closeBubble(); await placePet('right', 0.1); await sleep(500);
  layering.placeHeroSwiper = await hit();
  await tapPet(); await waitBubble('react'); await sleep(300);
  layering.placeHeroSwiperWithBubble = await hit();
  await shot('28-over-place-hero-swiper-with-bubble', 'Regression (browser): companion and bubble placed over the scenic introduction carousel photo.');
  await closeBubble();
  await ev(() => getCurrentPages().pop().compose()); await sleep(600);
  layering.journalSheetOpen = await hit();
  await shot('29-journal-sheet-hides-companion', 'Regression (browser): the journal composer sheet is open; the companion has stepped aside (covered=true).');
  await ev(() => getCurrentPages().pop().closeComposer()); await sleep(500);
  layering.journalSheetClosed = await hit();
  await ev(() => window.__harness.back()); await sleep(500);
  // panorama: over the scene photo in the movable-view, then the task sheet
  await closeBubble(); await ev(() => window.__harness.top().frame.scrollTo({ top: 0 })); await placePet('right', 0.32); await sleep(500);
  layering.panoramaPhotoMovableView = await hit();
  await shot('30-over-panorama-photo-movable-view', 'Regression (browser): companion over the panorama scene photograph (movable-view).');
  await ev(() => getCurrentPages().pop().select(3)); await sleep(400); await closeBubble();
  await ev(() => getCurrentPages().pop().task()); await sleep(600);
  layering.taskSheetOpen = Object.assign(await hit(), { showTask: await ev(() => getCurrentPages().pop().data.showTask) });
  await shot('31-task-sheet-hides-companion', 'Regression (browser): the scene task sheet is open; the companion has stepped aside.');
  await ev(() => getCurrentPages().pop().closeTask()); await sleep(500);
  layering.taskSheetClosed = await hit();
  await ev(() => getCurrentPages().pop().select(0)); await sleep(500); await closeBubble();
  layering.panoramaWebglStage = Object.assign(await hit(), { note: 'the harness does not emulate the WebGL canvas; this only shows the authored order' });
  // gallery: over a zoomed photo
  await ev(() => wx.navigateTo({ url: '/pages/gallery/index?id=1&index=0' })); await sleep(3500);
  await placePet('left', 0.75); await ev(() => { const p = getCurrentPages().pop(); p.zoomIn(); p.zoomIn(); }); await sleep(600);
  layering.galleryZoomedPhoto = Object.assign(await hit(), { zoom: await ev(() => getCurrentPages().pop().data.zoom) });
  await shot('32-over-gallery-zoomed-photo', 'Regression (browser): companion over a zoomed gallery photograph (movable-view scale).');
  await ev(() => window.__harness.back()); await sleep(300);
  // back catcher: how many page-container elements exist in the whole document at each step
  const catcher = results.checks.backCatcher = { note: 'DOM count over ALL pages kept alive by the harness (cached tabs and the page stack). Harness emulation, not the native component.' };
  await ev(() => wx.switchTab({ url: '/pages/village/index' })); await sleep(1200); await closeBubble();
  await placePet('right', 0.3); await sleep(500);
  layering.villageHeroSwiper = await hit();
  await shot('33-over-village-hero-swiper', 'Regression (browser): companion over the village tab hero carousel.');
  catcher.allTabsVisitedIdle = await containers();
  await frame.click(top('.tb-center')); await sleep(250);
  catcher.tabLayerOpening = Object.assign(await containers(), { phase: await phase() });
  await waitPhase('chat'); catcher.tabLayerChat = await containers();
  await ev(() => window.__harness.agent().openPlace({ currentTarget: { dataset: { id: 1 } } })); await sleep(1500);
  catcher.linkedPageOpenedFromChat = Object.assign(await containers(), { route: await route() });
  await closeBubble(); await pressPet(700); await page.mouse.up(); await waitPhase('chat'); await sleep(300);
  catcher.secondLayerOnPushedPage = Object.assign(await containers(), { route: await route() });
  catcher.hardwareBackOnPushedPage = await ev(() => window.__harness.back()); await waitPhase('idle'); await sleep(300);
  catcher.afterPushedLayerClosed = await containers();
  await ev(() => window.__harness.back()); await sleep(700);
  catcher.returnedToTabWithChatOpen = Object.assign(await containers(), { phase: await phase(), route: await route() });
  catcher.hardwareBackOnTab = await ev(() => window.__harness.back()); await waitPhase('idle'); await sleep(400);
  catcher.afterTabLayerClosed = await containers();
  for (const name of ['乡味好物', '我的', '线上寻樟']) { await tapText(top('.tb-item'), name); await sleep(700); }
  catcher.afterVisitingEveryTabAgain = await containers();
  catcher.maxMountedAtAnyStep = Math.max(...Object.values(catcher).filter(v => v && typeof v === 'object' && 'mounted' in v).map(v => v.mounted));

  fs.writeFileSync(path.join(outDir, 'browser-harness-capture-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.measurements, null, 1));
  console.log('console errors:', results.consoleErrors.length, results.consoleErrors.slice(0, 5));
  await browser.close();
  server.kill();
  fs.rmSync(framesDir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
