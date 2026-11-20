// Turns raw guide text (possibly partial, while streaming) into view data:
// paragraphs with inline source marks, source chips, follow-ups, creative flag.
const { sourceLabel } = require('./guide-prompt');
const knowledge = require('./guide-knowledge');

const followPattern = /(?:^|\n)[ \t]*[【〔\[（(]?\s*追问\s*[】〕\]）)]?\s*[:：]/;
const creativePattern = /[【〔\[（(]\s*创意讲述\s*[】〕\]）)]\s*[:：]?/;
const citePattern = /[\[［【(（]\s*((?:[SP]\d{2})(?:\s*[、,，·;；和及\s]\s*[SP]\d{2})*)\s*[\]］】)）]/g;

function stripMarkdown(text) {
  return text
    .replace(/\r/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '· ')
    .replace(/^[ \t]*>[ \t]?/gm, '');
}
function splitFollowups(text) {
  const match = followPattern.exec(text);
  if (!match) return { body: text, followups: [] };
  const tail = text.slice(match.index + match[0].length);
  const followups = tail.split(/[｜|\n]|；|;|(?:\d[.、])/).map(item => item.replace(/^[\s·、，。0-9.]+|[\s]+$/g, '')).filter(item => item.length >= 3 && item.length <= 30);
  return { body: text.slice(0, match.index), followups: [...new Set(followups)].slice(0, 3) };
}
function parse(raw) {
  let text = stripMarkdown(String(raw || ''));
  const creative = creativePattern.test(text);
  if (creative) text = text.replace(creativePattern, '');
  const split = splitFollowups(text);
  const body = split.body.trim();
  const cites = [];
  const paras = body.split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, p) => {
    const spans = [];
    let last = 0, n = 0;
    line.replace(citePattern, (whole, list, offset) => {
      if (offset > last) spans.push({ k: p + '-' + n++, cite: false, text: line.slice(last, offset) });
      const ids = list.match(/[SP]\d{2}/g).filter(id => knowledge.sources[id]);
      for (const id of ids) if (!cites.includes(id)) cites.push(id);
      if (ids.length) spans.push({ k: p + '-' + n++, cite: true, text: ' ' + ids.join('·') + ' ' });
      else spans.push({ k: p + '-' + n++, cite: false, text: whole });
      last = offset + whole.length;
      return whole;
    });
    if (last < line.length) spans.push({ k: p + '-' + n++, cite: false, text: line.slice(last) });
    return { k: 'p' + p, spans };
  });
  return {
    body,
    paras,
    creative,
    followups: split.followups,
    cites: cites.map(id => ({ id, label: sourceLabel(id) }))
  };
}
function sourceDetail(id) {
  const source = knowledge.sources[id];
  if (!source) return null;
  return { id, title: source.title, publisher: source.publisher, date: source.date, use: source.use };
}
module.exports = { parse, stripMarkdown, sourceDetail };
