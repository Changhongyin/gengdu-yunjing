// On-device lexical retrieval over the generated knowledge chunks.
// Returns a few relevant excerpts so the whole library is never sent by default.
const knowledge = require('./guide-knowledge');

const placeNames = ['千年古樟', '乌竹溪古水秤', '承启堂', '四本堂'];
const placePatterns = [
  /古樟|樟树|香樟|大樟|樟下|樟树王|古树/,
  /水秤|水称|分水|古甽|古圳|甽|水渠|渠道|明渠|暗渠|乌竹溪|水车|水轮|水系/,
  /承启堂|四份厅/,
  /四本堂|四本义塾|义塾|供销社|蔬菜.{0,2}(社|店|站)|合作社/
];
// Visitor wording -> knowledge wording. Appended to the query before scoring.
const aliases = [
  [/水车|水轮|水磨|称重|秤砣|秤杆|称水/, '水秤 分水石 不是称重 分水 公平'],
  [/水秤|水称|分水/, '水秤 分水石 分配水量 规则'],
  [/供销社|蔬菜.{0,2}(社|店|站)|合作社|菜店/, '四本堂 一经堂 义塾'],
  [/四本堂/, '四本堂 一经堂 义塾 耕读传统 门额'],
  [/承启堂|四份厅/, '承启堂 现场说明牌 马头墙 题额 厅堂'],
  [/多少岁|树龄|年龄|多大|几岁|多少年的树/, '古樟 树龄 1220年 千年古樟 挂牌档案'],
  [/爹|娘|樟树爹|樟树娘/, '樟树爹 樟树娘 亲切称呼'],
  [/博士村|博士(?!菜)|院士|大学生|读书|教育|耕读/, '博士村 耕读传家 教育传统 义塾'],
  [/博士菜|梅干菜|霉干菜|乡味|特产|吃/, '博士菜 梅干菜 求学 家庭'],
  [/御史|李学道|草鞋|清廉|李景莲/, '草鞋御史 李学道 清廉 御史第'],
  [/木雕|砖雕|榫卯|非遗|雕花/, '东阳木雕 国家级非遗 砖雕 榫卯'],
  [/村名|叫古渊头|名字|得名|由来/, '为什么叫古渊头 村名 筑堰引水 古堰头 古堰里'],
  [/历史|多少年|哪年|年代|朝代|永乐/, '600多年历史 明永乐 传统村落 时间线'],
  [/四古/, '四古 古樟 古甽 古民居 古墩墓'],
  [/在哪|地址|位置|哪个市|哪个镇/, '古渊头在哪里 东阳市巍山镇'],
  [/孩子|小朋友|亲子|研学|带娃|小孩/, '亲子研学 提问 观察 研学'],
  [/许愿|烧香|点香|祈福|拜/, '点香许愿 香烛 祈福 民俗'],
  [/喝|饮用|水质/, '水渠里的水可以直接喝吗 饮用'],
  [/桥|群安桥/, '群安桥 2020年 榫卯'],
  [/课|体验|手作|工坊|报名|预约/, '木作 砖雕课 课程 预约 运营方最新信息 拟设体验'],
  [/小程序|功能|怎么玩|明信片|卡片|全景|打卡|游记|路线演示|购物|下单/, '小程序里能做什么 景点介绍 实景影册 慢行路线 虚拟 演示'],
  [/注意|礼仪|文明|规矩|不能做|禁止/, '参观提示 不攀折 不移动石块 保持安静 从岸上观察'],
  [/概况|介绍一下|简介|总览|有什么好看|看什么|玩什么|逛/, '村庄总览 短讲解 树 水 屋 读书']
];
// Topics the supplied material cannot answer because they change in real time.
const livePatterns = [
  [/门票|票价|收费|要钱|多少钱|免费吗|价格/, '门票与收费'],
  [/开放时间|几点|开门|关门|营业|闭馆|开放吗|今天开/, '开放时间'],
  [/天气|下雨|气温|冷不冷|热不热/, '天气'],
  [/人多|排队|客流|拥挤/, '实时客流'],
  [/停车|公交|班车|自驾|怎么去|怎么走|路线怎么|导航|打车|高铁|多远|距离/, '交通、停车与导航'],
  [/电话|联系方式|客服|微信号/, '联系方式'],
  [/住宿|民宿|酒店|餐馆|饭店|吃饭的地方/, '住宿与餐饮商家'],
  [/活动时间|哪天举办|几号|节庆安排|预约|报名|订票/, '活动日程与预约']
];
// Words that point at the place the visitor is looking at, rather than at an earlier turn.
const hereWords = /这里|这儿|这处|这个地方|此处|此地|眼前|面前|当前|这一站|这一景|这个景点|这处景点|这棵|这座|这块|这条|这是哪|这是什么/;
const contextual = /^(那|那么|它|这|还有|再|继续|然后|为什么|为啥|怎么|所以|具体|详细|展开)|它|这个|那个|这里|那里|刚才|上面|前面|呢[？?]?$|吗[？?]?$/;
const stopWords = /为什么|是什么|什么|怎么样|怎么|今天|现在|明天|最近|哪里|哪儿|多少|可以|能不能|有没有|一下|介绍|讲讲|说说|告诉我|请问|你好|这里|那里|的|了|吗|呢|啊|呀|是|有|在|和|与|我|你|们/g;

const isCjk = ch => ch >= '㐀' && ch <= '鿿';
function grams(text) {
  const clean = String(text || '').replace(/[^㐀-鿿A-Za-z0-9]+/g, ' ');
  const out = [];
  for (const part of clean.split(' ')) {
    if (!part) continue;
    let run = '';
    for (const ch of part) {
      if (isCjk(ch)) { if (run && !isCjk(run[0])) { out.push(run.toLowerCase()); run = ''; } run += ch; }
      else { if (run && isCjk(run[0])) { pushCjk(run, out); run = ''; } run += ch; }
    }
    if (run) { if (isCjk(run[0])) pushCjk(run, out); else out.push(run.toLowerCase()); }
  }
  return out;
}
function pushCjk(run, out) {
  if (run.length === 1) { out.push(run); return; }
  for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
}

let index = null;
function build() {
  if (index) return index;
  const docs = knowledge.chunks.map(chunk => ({
    chunk,
    title: new Set(grams(chunk.title + ' ' + chunk.section)),
    body: new Set(grams(chunk.text))
  }));
  const df = {};
  for (const doc of docs) for (const g of new Set([...doc.title, ...doc.body])) df[g] = (df[g] || 0) + 1;
  index = { docs, df, total: docs.length };
  return index;
}
function scoreAll(query) {
  const { docs, df, total } = build();
  const terms = [...new Set(grams(query.replace(stopWords, ' ')))];
  return docs.map(doc => {
    let score = 0;
    for (const term of terms) {
      const weight = Math.log(1 + total / (df[term] || total * 4));
      if (doc.title.has(term)) score += weight * 2.2;
      if (doc.body.has(term)) score += weight;
    }
    return score / (1 + Math.log(1 + doc.chunk.text.length / 220) * 0.35);
  });
}
function detectPlaces(text) {
  const ids = [];
  placePatterns.forEach((pattern, id) => { if (pattern.test(text)) ids.push(id); });
  return ids;
}
function expand(question) {
  let query = question;
  for (const [pattern, extra] of aliases) if (pattern.test(question)) query += ' ' + extra;
  return query;
}
function liveTopics(question) {
  return livePatterns.filter(([pattern]) => pattern.test(question)).map(row => row[1]);
}

// history: [{question, places:[ids]}] of earlier turns, oldest first.
function retrieve(question, history, options) {
  const settings = Object.assign({ limit: 5, budget: 1700, minScore: 4 }, options || {});
  const text = String(question || '').trim();
  const previous = history && history.length ? history[history.length - 1] : null;
  let places = detectPlaces(text);
  const live = liveTopics(text);
  const aboutVillage = !places.length && /古渊头|村子|村庄|村落|这个村|全村|村里/.test(text);
  const scores = scoreAll(expand(text));
  // A short question that already matches the material well stands on its own.
  const ownBest = Math.max.apply(null, scores.concat(0));
  const conversational = !!previous && !places.length && !aboutVillage && !live.length && (contextual.test(text) || (text.length <= 14 && ownBest < 12));
  // Page context (settings.contextPlace: 0..3 or 'village'). It never overrides a place or the
  // village named in the question. "Here" words follow the page even when an earlier turn was
  // about another place; other short or deictic questions follow the conversation first.
  const here = settings.contextPlace;
  const hasHere = here === 'village' || (Number.isInteger(here) && !!placeNames[here]);
  const explicit = places.length > 0 || aboutVillage || live.length > 0;
  const pointsHere = hasHere && !explicit && hereWords.test(text);
  const usesContext = !pointsHere && conversational;
  const usesPlaceContext = pointsHere || (hasHere && !explicit && !usesContext && (contextual.test(text) || (text.length <= 14 && ownBest < 12)));
  let hereVillage = false;
  if (usesContext) {
    const earlier = scoreAll(expand(previous.question));
    for (let i = 0; i < scores.length; i++) scores[i] += earlier[i] * 0.6;
    places = (previous.places || []).slice();
  } else if (usesPlaceContext) {
    const hint = scoreAll(expand(here === 'village' ? '古渊头村 概况 介绍一下' : placeNames[here]));
    for (let i = 0; i < scores.length; i++) scores[i] += hint[i] * 0.6;
    if (here === 'village') hereVillage = true; else places = [here];
  }
  const { docs } = build();
  const ranked = docs.map((doc, i) => {
    let score = scores[i];
    if (places.some(id => doc.chunk.places.includes(id))) score *= 1.25;
    if (doc.chunk.kind === 'qa') score *= 1.1;
    if (live.length && (doc.chunk.id === 'APP-features' || doc.chunk.id === 'Q23' || doc.chunk.id === 'Q01')) score += 3;
    return { chunk: doc.chunk, score };
  }).filter(row => row.score >= settings.minScore).sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const row of ranked) {
    if (picked.length >= settings.limit) break;
    if (picked.length && row.score < ranked[0].score * 0.34) break;
    if (used + row.chunk.text.length > settings.budget && picked.length) continue;
    picked.push(row);
    used += row.chunk.text.length;
  }
  return {
    question: text,
    chunks: picked.map(row => row.chunk),
    scores: picked.map(row => Number(row.score.toFixed(2))),
    places,
    primaryPlace: places.length ? places[0] : aboutVillage || hereVillage ? 'village' : null,
    live,
    usesContext,
    usesPlaceContext
  };
}
module.exports = { retrieve, detectPlaces, liveTopics, grams, placeNames };
