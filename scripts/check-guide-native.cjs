// Compiles every WXML and WXSS file (including the new custom tab bar and guide
// component) with the official WeChat compilers, when they are available.
// Usage (from work/):
//   node scripts/check-guide-native.cjs
//   WCC_DIR=<folder containing wcc(.exe) and wcsc(.exe)> node scripts/check-guide-native.cjs
// Compiler sources: WeChat DevTools (.../node_modules/wcc-exec) or the
// "miniprogram-compiler" npm package (bin/<platform>).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const exe = process.platform === 'win32' ? '.exe' : '';
const candidates = [process.env.WCC_DIR, '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec'].filter(Boolean);
const dir = candidates.find(d => fs.existsSync(path.join(d, 'wcc' + exe)) || fs.existsSync(path.join(d, 'wcc')));
if (!dir) { console.log('SKIP: WeChat compilers (wcc, wcsc) not found. Set WCC_DIR.'); process.exit(0); }
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
const files = ['pages', 'components', 'custom-tab-bar'].flatMap(walk);
let failed = false;
for (const [compiler, ext, extra] of [['wcc', '.wxml', []], ['wcsc', '.wxss', ['app.wxss']]]) {
  const bin = fs.existsSync(path.join(dir, compiler + exe)) ? path.join(dir, compiler + exe) : path.join(dir, compiler);
  const inputs = extra.concat(files.filter(f => f.endsWith(ext)));
  const result = cp.spawnSync(bin, ['-o', path.join(os.tmpdir(), 'guide-native-' + compiler + '.js'), ...inputs], { encoding: 'utf8' });
  if (result.status === 0) console.log('PASS: ' + compiler + ' compiled ' + inputs.length + ' files.');
  else { failed = true; console.log('FAIL: ' + compiler + ' exit ' + result.status + '\n' + (result.stderr || result.stdout || result.error)); }
}
process.exit(failed ? 1 : 0);
