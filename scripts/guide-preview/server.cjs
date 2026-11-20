// Local server for the preview harness. Development tool only; never deployed.
// Serves work/ read-only, a source bundle for the browser runtime, and a proxy
// that lets the harness reach the configured provider with the key kept server-side.
// Usage: node scripts/guide-preview/server.cjs [port]   then open http://127.0.0.1:<port>/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function env() {
  const file = path.resolve(root, '..', 'api-config', '.env.local');
  const out = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
  return out;
}
function bundle() {
  const files = {};
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|json|wxml|wxss)$/.test(e.name)) files[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
    }
  };
  for (const dir of ['pages', 'components', 'custom-tab-bar', 'utils']) walk(dir);
  for (const file of ['app.js', 'app.json', 'app.wxss']) files[file] = fs.readFileSync(path.join(root, file), 'utf8');
  return 'window.__BUNDLE__=' + JSON.stringify({ files }) + ';';
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/__bundle.js') {
      res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
      return res.end(bundle());
    }
    if (url.pathname === '/__proxy' && req.method === 'POST') {
      const config = env();
      const target = String(req.headers['x-target-url'] || '');
      const allowed = (config.CHERRYIN_BASE_URL || 'https://open.cherryin.net/v1').replace(/\/+$/, '');
      if (!target.startsWith(allowed + '/')) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: { message: 'harness proxy only forwards to the configured provider' } }));
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { 'Content-Type': 'application/json' };
      if (req.headers['x-forward-auth'] === '1') headers.Authorization = 'Bearer ' + (config.CHERRYIN_API_KEY || '');
      const upstream = await fetch(target, { method: 'POST', headers, body: Buffer.concat(chunks) });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'text/plain', 'Cache-Control': 'no-store' });
      if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }
    // Optional: this VM has no KaiTi/STKaiti. HARNESS_KAI_FONT may point at the
    // open-source lxgw-wenkai-webfont package so headings render in a Kai face.
    if (url.pathname.startsWith('/__font/')) {
      const dir = process.env.HARNESS_KAI_FONT;
      const name = path.basename(url.pathname);
      if (!dir) { res.writeHead(404); return res.end(); }
      if (name === 'kai.css') {
        const css = fs.readFileSync(path.join(dir, 'lxgwwenkai-regular.css'), 'utf8')
          .replace(/'LXGW WenKai'/g, "'STKaiti'").replace(/font-display: swap/g, 'font-display: block').replace(/\.\/files\//g, '/__font/');
        res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'max-age=3600' });
        return res.end(css);
      }
      const font = path.join(dir, 'files', name);
      if (!/^[\w.-]+\.woff2$/.test(name) || !fs.existsSync(font)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(font).pipe(res);
    }
    let file = url.pathname === '/' ? '/scripts/guide-preview/shell.html' : decodeURIComponent(url.pathname);
    if (file === '/frame.html' || file === '/runtime.js') file = '/scripts/guide-preview' + file;
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': /\.(jpg|png)$/.test(full) ? 'max-age=3600' : 'no-store' });
    fs.createReadStream(full).pipe(res);
  } catch (error) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: { message: 'harness proxy: ' + error.message } }));
  }
}).listen(port, '127.0.0.1', () => console.log('Guide preview harness: http://127.0.0.1:' + port + '/  (not the WeChat runtime)'));
