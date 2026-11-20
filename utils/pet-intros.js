// What the companion says without the network.
//
// Introductions are prepared, source-grounded text. They are local material and
// are always labeled as such in the bubble; they are never presented as model output.
// Each introduction names the knowledge chunks it rests on (ground) and the
// phrases that must still be present there (must). scripts/check-pet.cjs fails
// when a rebuilt knowledge module no longer supports an introduction, and at
// runtime an unsupported introduction falls back to an excerpt quoted through the
// same retrieval pipeline the chat uses.
const knowledge = require('./guide-knowledge');
const retrieval = require('./guide-retrieval');
const demo = require('./guide-demo');
const { sourceLabel } = require('./guide-prompt');
const { places, village } = require('./places');

const LOCAL_TAG = '本地讲解资料';
const intros = {
  0: {
    title: '千年古樟',
    text: '你来到村北口的古樟下啦。村民亲切地叫它们“樟树爹”“樟树娘”。2021年最高检网站的报道把树龄记为1220年，所以大家常说“千年古樟”；精确树龄要以最新挂牌档案为准。',
    ref: '知识库第六节', sources: ['S02', 'S05'],
    ground: [{ id: 'K6-2', must: ['樟树爹', '樟树娘', '1220年', '2021年', '挂牌档案'] }]
  },
  1: {
    title: '乌竹溪古水秤',
    text: '这里是乌竹溪古水秤。它不是水车，也不是称重量的秤，而是渠道里的一块分水石：按用户和田亩的用水需要，把一股水分到不同去处，守的是大家共同认可的分水规矩。',
    ref: '知识库第五节', sources: ['S03'],
    ground: [{ id: 'K5-3', must: ['分水石', '用户', '田亩', '分水规则'] }, { id: 'Q14', must: ['不是', '分水石'] }]
  },
  2: {
    title: '承启堂',
    text: '这是承启堂，又名“四份厅”。现场说明牌写着它初建于清道光年间，可以留意五级马头墙、砖雕和“承启堂”题额。年代与名称都依现场标牌整理，开放范围以现场安排为准。',
    ref: '承启堂现场说明牌（调研原片）· 知识库第四节', sources: [],
    ground: [{ id: 'APP-2', must: ['四份厅', '清道光年间', '五级马头墙', '砖雕', '题额', '现场标牌'] }]
  },
  3: {
    title: '四本堂',
    text: '这里是四本堂。报道把四本堂、一经堂与四本义塾联系在一起，记下办义塾、延请教师、资助子弟求学的旧事。古渊头“耕读传家”的文脉，可以从这处门额读起。',
    ref: '知识库第二、四节', sources: ['S04'],
    ground: [{ id: 'K2-2', must: ['四本堂、一经堂与四本义塾', '办义塾', '延请教师', '资助子弟求学'] }, { id: 'APP-3', must: ['门额'] }]
  },
  village: {
    title: '古渊头村',
    text: '欢迎来到古渊头村，它在浙江省东阳市巍山镇。2016年浙江日报的报道说这里有600多年历史，村名与筑堰引水、村中水渠有关。古樟、古甽和老屋里，藏着一村人耕读传家的故事。',
    ref: '知识库第一节', sources: ['S02', 'S03'],
    ground: [{ id: 'K1-1', must: ['东阳市巍山镇', '2016年', '600多年历史', '筑堰引水'] }]
  },
  route: {
    title: '慢行路线',
    text: '这条慢行路线是虚拟演示：顺序只作游览示意，没有接入地图定位和真实导航，不代表实际方位、距离或通行情况。点选一站，我陪你读它的故事。',
    ref: '小程序功能说明', sources: [],
    ground: [{ id: 'APP-features', must: ['虚拟路线演示', '未接入地图定位和真实导航', '不代表实际方位、距离或通行情况'] }]
  },
  // A greeting, not a factual introduction: no source line.
  greet: {
    title: '阿樟',
    text: '你好呀，我是阿樟，陪你在线上逛古渊头。点地图上的景点就能进全景；想慢慢聊，长按我就行。',
    ref: '', sources: [], ground: [], greeting: true
  }
};

const chunkById = id => knowledge.chunks.find(chunk => chunk.id === id);
// true when every grounding chunk still exists and still contains the required phrases
function supported(topic) {
  const intro = intros[topic];
  if (!intro) return false;
  return intro.ground.every(row => { const chunk = chunkById(row.id); return !!chunk && row.must.every(phrase => chunk.text.includes(phrase)); });
}
function sourceLine(intro) {
  const parts = [];
  if (intro.ref) parts.push(intro.ref);
  for (const id of intro.sources) if (knowledge.sources[id]) parts.push(sourceLabel(id));
  return parts.length ? '依据：' + parts.join(' · ') : '';
}
const topicName = topic => topic === 'village' ? village.name : places[topic] ? places[topic].name : '';
// Fallback when the prepared text is no longer supported by the knowledge module:
// quote the knowledge base through the chat's own retrieval and demo composer.
function quoted(topic) {
  const name = topicName(topic);
  if (!name) return null;
  const found = retrieval.retrieve('给我讲讲' + name, []);
  if (!found.chunks.length) return null;
  const body = demo.compose(found).split(/\n追问[:：]/)[0].replace(/\n+/g, '').trim();
  return { topic, title: name, text: body.length > 150 ? body.slice(0, 148) + '…' : body, source: '依据：知识库原文摘录', tag: LOCAL_TAG, greeting: false, quoted: true };
}
function get(topic) {
  const intro = intros[topic];
  if (!intro) return null;
  if (!supported(topic)) return quoted(topic);
  return { topic, title: intro.title, text: intro.text, source: sourceLine(intro), tag: intro.greeting ? '' : LOCAL_TAG, greeting: !!intro.greeting, quoted: false };
}

// ---- single-tap reactions -------------------------------------------------
// Short lines. Observation prompts repeat the "AI 原创观察引导" already shown on
// the introduction pages; none of them adds a historical claim.
const generic = [
  { pose: 'approve', anim: 'pop', text: '我在呢～想慢慢聊，长按我就行。' },
  { pose: 'shy', anim: 'squish', text: '嘿嘿，被你发现啦。' },
  { pose: 'walk', anim: 'hop', text: '慢慢走，慢慢看，我陪着你。' },
  { pose: 'cheer', anim: 'hop', text: '今天也一起逛逛古渊头吧！' }
];
const byPlace = {
  0: [{ pose: 'point', anim: 'talk', text: '抬头找一找：哪些大枝条有支撑？' }, { pose: 'approve', anim: 'pop', text: '看古樟请站在保护区域外，不踩根区哦。' }],
  1: [{ pose: 'fish', anim: 'splash', text: '看一会儿水：石块两侧的水怎样流？' }, { pose: 'point', anim: 'talk', text: '从岸上观察就好，不移动石块、不堵水渠。' }],
  2: [{ pose: 'think', anim: 'think', text: '从门外到堂内，光线是怎样变化的？' }, { pose: 'point', anim: 'talk', text: '先读门额，再看梁架和砖雕。' }],
  3: [{ pose: 'read', anim: 'nod', text: '读一读门额上的字吧。' }, { pose: 'think', anim: 'think', text: '若给今天的孩子留一句家训，你想留什么？' }],
  village: [{ pose: 'point', anim: 'talk', text: '树、水、屋、书，想先看哪一样？' }]
};
const byKind = {
  map: [{ pose: 'point', anim: 'talk', text: '点地图上的景点，就能进全景漫游。' }],
  route: [{ pose: 'walk', anim: 'hop', text: '这是虚拟路线演示，不是真实导航哦。' }],
  cards: [{ pose: 'read', anim: 'nod', text: '一景一笺，集齐四张就点亮成就卡。' }],
  postcard: [{ pose: 'approve', anim: 'pop', text: '这一枚，是你的寻樟印记。' }],
  gallery: [{ pose: 'read', anim: 'nod', text: '双指可以放大原片，细节都在里面。' }]
};
// n: how many taps so far. Rotates so the same line and motion never repeat back to back.
function reaction(context, n) {
  const ctx = context || {};
  const pool = [];
  if (byKind[ctx.kind]) pool.push(...byKind[ctx.kind]);
  if (ctx.kind !== 'map' && ctx.kind !== 'cards' && byPlace[ctx.place]) pool.push(...byPlace[ctx.place]);
  pool.push(...generic);
  return pool[((n % pool.length) + pool.length) % pool.length];
}
const special = {
  celebrate: { pose: 'celebrate', anim: 'jump', text: '拾得一枚樟影！明信片已经收进卡集啦。' },
  wake: { pose: 'greet', anim: 'wave', text: '唔…我醒着呢，刚才只是眯了一小会儿。' },
  restore: { pose: 'greet', anim: 'wave', text: '我回来啦。' },
  hint: { pose: 'greet', anim: 'wave', text: '轻点我有回应，长按我可以对话，按住拖动能给我挪位置。' }
};
module.exports = { get, supported, reaction, special, topicName, topics: Object.keys(intros), raw: intros, LOCAL_TAG };
