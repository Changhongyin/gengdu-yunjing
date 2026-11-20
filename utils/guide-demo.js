// Offline demo composer. It quotes the retrieved knowledge excerpts directly.
// Output is always labeled as demo in the interface; it is not model output.
const sentences = text => (text.match(/[^。！？]+[。！？]?/g) || []).map(s => s.trim()).filter(Boolean);
// Notes addressed to editors rather than visitors are not quoted in demo answers.
const editorial = /讲解(应|宜|可)|入库|本稿|AI讲解|应标为|建议现场|前期调研|可据此|适合把|不在AI|可邀请|数字形象|图F0\d|不作具体/;
const clean = text => text.replace(/^问：.*\n答：/, '').replace(/【表头】[^\n]*\n?/g, '').replace(/\n+/g, ' ').trim();
function excerpt(chunk, max) {
  const out = [];
  let length = 0;
  for (const sentence of sentences(clean(chunk.text))) {
    if (editorial.test(sentence)) continue;
    if (length + sentence.length > max && out.length) break;
    out.push(sentence);
    length += sentence.length;
  }
  return out.join('');
}
function cite(chunk) {
  return chunk.kind === 'qa' ? '' : '（' + chunk.ref + (chunk.src.length ? '；' + chunk.src.slice(0, 2).map(id => '[' + id + ']').join('') : '') + '）';
}
function compose(retrieval) {
  const { chunks, live, question } = retrieval;
  const parts = [];
  if (/水车|水轮/.test(question)) parts.push('先更正一个常见说法：乌竹溪古水秤不是水车，也不是称重量的秤，而是渠道里用于分水的石质设施。');
  if (/供销社|蔬菜.{0,2}(社|店|站)/.test(question)) parts.push('这处景点现在的名称是“四本堂”，小程序中已统一使用这个名称。');
  if (/(编|写|创作|虚构)一?(个|段|首)?.{0,6}(故事|诗)|小故事|想象一下|拟人|口吻/.test(question)) parts.push('离线演示只引用资料原文，不生成故事或诗。连接在线讲解后，创作内容会以“创意讲述”标注。下面是资料里的相关记载：');
  if (live.length) parts.push('关于“' + live.join('、') + '”，提供的资料里没有这类实时信息，我不能替你估计，请以村方或运营方的最新公告为准。');
  if (!chunks.length) {
    if (!parts.length) parts.push('这个问题在提供的古渊头村讲解资料里没有找到依据，我不便随意回答。你可以换个角度，问问村里的树、水、屋和读书的故事。');
    return parts.join('\n') + '\n追问：古渊头为什么叫这个名字？｜古水秤是做什么用的？｜为什么被称为“博士村”？';
  }
  // "Tell me in detail" prefers a full prepared script from section nine of the knowledge base.
  const detailed = /详细|完整|展开|多讲|仔细|长一点/.test(question);
  const script = detailed ? chunks.find(chunk => chunk.kind === 'script' && chunk.text.length > 300) : null;
  const first = script || chunks[0];
  if (script) {
    parts.push(script.text.replace(/\n+/g, '\n') + '\n' + cite(script));
    return parts.join('\n') + '\n追问：古水秤为什么能讲公平？｜四本堂和一经堂可以讲什么？｜博士菜是什么菜？';
  }
  parts.push(excerpt(first, live.length ? 110 : 230) + cite(first));
  const second = chunks.find((chunk, i) => i > 0 && chunk.kind !== 'qa' && chunk.section !== first.section && chunk.text.length >= 60);
  if (second && !live.length) parts.push(excerpt(second, 120) + cite(second));
  const follow = chunks.slice(1).concat(chunks).filter(chunk => chunk.kind === 'qa' && chunk !== first).map(chunk => chunk.title + '？');
  const defaults = ['古水秤为什么能讲公平？', '古樟为什么叫“樟树爹”“樟树娘”？', '四本堂和一经堂可以讲什么？'];
  const followups = [...new Set(follow.concat(defaults))].filter(item => !question.includes(item.slice(0, 6))).slice(0, 3);
  return parts.join('\n') + '\n追问：' + followups.join('｜');
}
module.exports = { compose };
