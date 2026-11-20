// Dependency-free DOCX reader used by the guide knowledge build.
// Reads word/document.xml straight from the supplied DOCX (the authoritative
// source) and returns body blocks in document order: paragraphs and tables.
const fs = require('node:fs');
const zlib = require('node:zlib');

function unzipEntry(file, name) {
  const buf = fs.readFileSync(file);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a ZIP container: ' + file);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error('Missing ZIP entry: ' + name);
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function paragraphText(xml) {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) out += m[1] !== undefined ? decode(m[1]) : ' ';
  return out.replace(/\s+/g, ' ').trim();
}
function paragraphs(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => ({
    style: (/<w:pStyle w:val="([^"]+)"/.exec(m[0]) || [])[1] || '',
    text: paragraphText(m[0])
  })).filter(p => p.text);
}
function readBlocks(file) {
  const xml = unzipEntry(file, 'word/document.xml').toString('utf8');
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>'));
  const blocks = [];
  let pos = 0;
  while (pos < body.length) {
    const t = body.indexOf('<w:tbl>', pos);
    const chunk = body.slice(pos, t < 0 ? body.length : t);
    for (const p of paragraphs(chunk)) blocks.push({ type: 'p', style: p.style, text: p.text });
    if (t < 0) break;
    const e = body.indexOf('</w:tbl>', t) + 8;
    const rows = [...body.slice(t, e).matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map(r =>
      [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(c => paragraphs(c[0]).map(p => p.text).join(' ')));
    blocks.push({ type: 'table', rows });
    pos = e;
  }
  return blocks;
}
module.exports = { readBlocks, unzipEntry };
