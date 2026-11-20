// Builds utils/guide-knowledge.js from the supplied knowledge DOCX.
// The DOCX stays the authoritative source: this script only reads it.
// Usage: node scripts/build-guide-knowledge.cjs [path-to-docx]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readBlocks } = require('./lib/docx-read.cjs');

const root = path.resolve(__dirname, '..');
const docx = path.resolve(process.argv[2] || require('./lib/project-paths.cjs').knowledge);
const blocks = readBlocks(docx);
const numerals = '一二三四五六七八九十';
const sectionPattern = new RegExp('^([' + numerals + ']{1,2})\\s+(.+)$');
const sourcesOf = text => [...new Set([...text.matchAll(/\b([SP]\d{2})\b/g)].map(m => m[1]))];
const placesOf = text => {
  const ids = [];
  if (/古樟|樟树/.test(text)) ids.push(0);
  if (/水秤|分水|古甽|甽水|水渠|明渠|暗渠/.test(text)) ids.push(1);
  if (/承启堂/.test(text)) ids.push(2);
  if (/四本堂|义塾|一经堂/.test(text)) ids.push(3);
  return ids;
};
const tableText = rows => rows.map((row, i) => (i === 0 ? '【表头】' : '') + row.join('｜')).join('\n');

const chunks = [];
const sources = {};
const figures = [];
let section = null, sub = null, pendingQuestion = null, pendingSource = null, pendingFigure = null;
const sectionSources = {};
const flush = () => {
  if (!sub || !sub.lines.length) { sub = null; return; }
  chunks.push({ sec: section.no, secTitle: section.title, title: sub.title, kind: sub.kind, text: sub.lines.join('\n') });
  sub = null;
};

for (const block of blocks) {
  if (block.type === 'table') {
    if (!section) continue;
    if (!sub) sub = { title: section.title, kind: 'section', lines: [] };
    sub.lines.push(tableText(block.rows));
    continue;
  }
  const text = block.text;
  const heading = sectionPattern.exec(text);
  if (heading && (block.style === '1' || (!block.style && text.length < 20))) {
    flush();
    pendingQuestion = pendingSource = pendingFigure = null;
    section = { no: heading[1], title: heading[2].trim() };
    continue;
  }
  if (!section) continue;
  if (/^资料依据/.test(text)) {
    sectionSources[section.no + '|' + section.title] = sourcesOf(text);
    continue;
  }
  if (section.no === '十' && /^Q\d{2}\s/.test(text)) { flush(); pendingQuestion = text; continue; }
  if (pendingQuestion) {
    const code = pendingQuestion.slice(0, 3);
    chunks.push({ sec: section.no, secTitle: '常见游客问答', title: pendingQuestion, kind: 'qa', code,
      text: '问：' + pendingQuestion.slice(4) + '\n答：' + text });
    pendingQuestion = null;
    continue;
  }
  if (section.no === '十一') {
    if (/^S\d{2}\s/.test(text)) { pendingSource = text; continue; }
    if (pendingSource) {
      const id = pendingSource.slice(0, 3);
      const meta = /^(.*?)\s*\|\s*(.*?)用途：(.*?)(?:查看原文)?$/.exec(text) || [];
      sources[id] = { id, title: pendingSource.slice(4).trim(), publisher: (meta[1] || '').trim(),
        date: (meta[2] || '').trim(), use: (meta[3] || text).trim().replace(/。$/, '') };
      pendingSource = null;
    }
    continue;
  }
  if (section.no === '十三') {
    if (/^F\d{2}\s/.test(text)) { pendingFigure = text; continue; }
    if (pendingFigure) { figures.push({ id: pendingFigure.slice(0, 3), title: pendingFigure.slice(4), note: text.replace(/原报道\s*原图文件$/, '').trim() }); pendingFigure = null; continue; }
    const project = /^(P\d{2})\s+(.*)$/.exec(text);
    if (project) { sources[project[1]] = { id: project[1], title: '用户提供的项目材料', publisher: '项目方', date: '', use: project[2] }; continue; }
  }
  if (block.style === '21') { flush(); sub = { title: text, kind: /讲解$|^短讲解|^标准讲解/.test(text) ? 'script' : 'section', lines: [] }; continue; }
  if (/^F\d{2}\s/.test(text) && block.style === 'af7') continue; // figure captions are indexed from section 13
  if (!sub) sub = { title: section.title, kind: 'section', lines: [] };
  sub.lines.push(text);
}
flush();

// Finalize DOCX chunks.
const counters = {};
const out = chunks.map(chunk => {
  const key = chunk.sec + '|' + chunk.secTitle;
  const own = sourcesOf(chunk.text);
  const inherited = sectionSources[chunk.sec + '|' + chunk.secTitle] || [];
  const secLabel = chunk.kind === 'qa' ? '知识库第十节' : '知识库第' + chunk.sec + '节';
  counters[key] = (counters[key] || 0) + 1;
  return {
    id: chunk.kind === 'qa' ? chunk.code : 'K' + (numerals.indexOf(chunk.sec[0]) + 1 + (chunk.sec.length > 1 ? numerals.indexOf(chunk.sec[1]) + 1 : 0)) + '-' + chunk.secTitle.replace(/\D/g, '') + counters[key],
    kind: chunk.kind,
    ref: chunk.kind === 'qa' ? secLabel + ' ' + chunk.code : secLabel + '「' + chunk.title + '」',
    section: chunk.secTitle,
    title: chunk.kind === 'qa' ? chunk.title.slice(4) : chunk.title,
    text: chunk.text,
    src: own.length ? own : inherited,
    places: placesOf(chunk.title + chunk.text)
  };
});
const ids = new Set();
for (const chunk of out) { if (ids.has(chunk.id)) throw new Error('Duplicate chunk id ' + chunk.id); ids.add(chunk.id); }

// In-app scenic introductions. These repeat what the mini-program already shows.
// Chengqi Hall facts come from the on-site sign photographed during research.
const { places, village } = require('../utils/places');
for (const place of [...places, village]) {
  out.push({
    id: 'APP-' + place.id, kind: 'app',
    ref: '小程序景点介绍「' + place.name + '」',
    section: '小程序内景点介绍', title: place.name,
    text: [place.name + '：' + place.summary, ...place.sections.map(s => s.title + '。' + s.text), '参观提示：' + place.note, '介绍页依据：' + place.sources].join('\n'),
    src: sourcesOf(place.sources), places: place.id === 'village' ? [] : [place.id]
  });
}
out.push({
  id: 'APP-features', kind: 'app', ref: '小程序功能说明', section: '小程序内可用体验', title: '小程序里能做什么',
  text: [
    '景点介绍页：村落总览和四处景点各有图文介绍，可从“古村漫行”进入。',
    '实景影册：每处景点三张实地调研原片，可切换和放大。',
    '慢行路线：是虚拟路线演示，未接入地图定位和真实导航，顺序不代表实际方位、距离或通行情况。',
    '线上寻樟与全景漫游：完成景点小任务可收集卡片和明信片；完成至少两个普通关卡后解锁终章四本堂。千年古樟提供本地360度实景，其余景点为实景照片。',
    '本机游记：留言只保存在当前设备，不公开发布，也不验证实际到访。',
    '乡味好物：商品、购物车、订单与支付均为演示，不会发生真实交易，未连接商家后台或在线客服。',
    '小程序没有提供：门票与票价、开放时间、实时客流、天气、停车与交通班次、预约报名、电话客服、真实地图导航。'
  ].join('\n'),
  src: [], places: []
});

const digest = crypto.createHash('sha256').update(fs.readFileSync(docx)).digest('hex');
const payload = { generatedFrom: path.relative(root, docx).split(path.sep).join('/'), docxSha256: digest, chunks: out, sources, figures };
const banner = '// GENERATED by scripts/build-guide-knowledge.cjs from the supplied knowledge DOCX.\n' +
  '// Do not edit by hand; re-run the script when the DOCX changes.\n';
fs.writeFileSync(path.join(root, 'utils', 'guide-knowledge.js'), banner + 'module.exports=' + JSON.stringify(payload, null, 1) + ';\n');
const chars = out.reduce((n, c) => n + c.text.length, 0);
console.log('Built utils/guide-knowledge.js: ' + out.length + ' chunks (' + out.filter(c => c.kind === 'qa').length + ' Q&A), ' +
  Object.keys(sources).length + ' sources, ' + chars + ' characters, DOCX sha256 ' + digest.slice(0, 12) + '...');
