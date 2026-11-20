// Preview harness runtime (browser). NOT the WeChat runtime.
// It interprets this project's real WXML, WXSS and JS well enough to look at
// layout and motion in a desktop browser. Native behavior is approximated:
// see README.md in this folder for the list of differences.
(function () {
  'use strict';
  const bundle = window.__BUNDLE__;
  const shell = window.parent && window.parent !== window ? window.parent.__shell : null;
  const harness = window.__harness = { net: 'proxy', keyboard: true, keyboardHeight: 300, log: [], requests: [] };
  const files = bundle.files;
  const appJson = JSON.parse(files['app.json']);
  const TAGS = ['view', 'text', 'image', 'button', 'input', 'textarea', 'swiper-item', 'swiper', 'scroll-view', 'movable-area', 'movable-view', 'picker', 'canvas', 'web-view', 'page-container', 'page-meta', 'root-portal'];

  // ---------------------------------------------------------------- styles
  const customTags = new Set();
  for (const name of Object.keys(files)) if (name.endsWith('.json') && name !== 'app.json') {
    try { Object.keys(JSON.parse(files[name]).usingComponents || {}).forEach(tag => customTags.add(tag)); } catch (e) {}
  }
  const tagPattern = new RegExp('(^|[\\s>+~,(])(' + [...TAGS, ...customTags].join('|') + ')(?=$|[\\s.#:>+~,\\[)])', 'g');
  const units = css => css.replace(/(-?\d*\.?\d+)rpx/g, (m, n) => (Number(n) / 7.5).toFixed(4).replace(/\.?0+$/, '') + 'vw').replace(/env\(\s*safe-area-inset-bottom\s*\)/g, 'var(--safe-bottom)');
  function rewriteSelector(selector, scope) {
    return selector.split(',').map(part => {
      let s = part.trim().replace(tagPattern, '$1wx-$2');
      if (!scope) return s.replace(/^page\b/, '.wx-page');
      if (/^page\b/.test(s)) return scope + s.slice(4);
      return scope + ' ' + s;
    }).join(',');
  }
  function transformCss(css, scope) {
    let out = '', i = 0;
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    while (i < css.length) {
      const open = css.indexOf('{', i);
      if (open < 0) break;
      const prelude = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      const body = css.slice(open + 1, j - 1);
      if (/^@(-webkit-)?keyframes|^@font-face/.test(prelude)) out += prelude + '{' + units(body) + '}\n';
      else if (/^@media|^@supports/.test(prelude)) out += prelude + '{' + transformCss(body, scope) + '}\n';
      else out += rewriteSelector(prelude, scope) + '{' + units(body) + '}\n';
      i = j;
    }
    return out;
  }
  function loadWxss(file) {
    const css = files[file] || '';
    const dir = file.slice(0, file.lastIndexOf('/') + 1);
    return css.replace(/@import\s+["']([^"']+)["']\s*;/g, (m, target) => loadWxss(resolvePath(dir, target)));
  }
  function addStyle(css, id) { const el = document.createElement('style'); el.dataset.source = id; el.textContent = css; document.head.appendChild(el); }
  addStyle(transformCss(loadWxss('app.wxss'), ''), 'app.wxss');
  const styled = new Set();
  function ensureStyle(base, scope) {
    if (styled.has(base)) return;
    styled.add(base);
    if (files[base + '.wxss']) addStyle(transformCss(loadWxss(base + '.wxss'), scope), base + '.wxss');
  }

  // ---------------------------------------------------------------- modules
  function resolvePath(dir, target) {
    const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
    const out = [];
    for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
    return out.join('/');
  }
  const modules = {};
  function requireFrom(dir, target) {
    let file = resolvePath(dir, target);
    if (!(file in files)) file = (file + '.js') in files ? file + '.js' : file + '/index.js';
    if (!(file in files)) throw new Error('Harness: module not found ' + target + ' from ' + dir);
    if (modules[file]) return modules[file].exports;
    const module = modules[file] = { exports: {} };
    const fn = new Function('require', 'module', 'exports', files[file] + '\n//# sourceURL=wx:///' + file);
    fn(t => requireFrom(file.slice(0, file.lastIndexOf('/') + 1), t), module, module.exports);
    return module.exports;
  }
  harness.require = file => requireFrom('', file);

  // ---------------------------------------------------------------- templates
  let templateSeq = 0;
  function parseWxml(source) {
    const rootNode = { children: [] };
    const stack = [rootNode];
    const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(source))) {
      const parent = stack[stack.length - 1];
      if (m[1]) { stack.pop(); continue; }
      if (m[2]) {
        const attrs = {};
        const attrRe = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
        let a;
        while ((a = attrRe.exec(m[3]))) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : true;
        const node = { id: ++templateSeq, tag: m[2], attrs, children: [] };
        parent.children.push(node);
        if (!m[4]) stack.push(node);
        continue;
      }
      if (m[5] !== undefined) {
        const inText = parent.tag === 'text';
        const value = inText ? m[5] : m[5].replace(/^\s*\n\s*|\s*\n\s*$/g, '');
        if (value.trim() || (inText && value)) parent.children.push({ id: ++templateSeq, text: inText ? value : value.trim() });
      }
    }
    return rootNode.children;
  }
  const exprCache = {};
  function evaluate(expr, scope) {
    let fn = exprCache[expr];
    if (!fn) { try { fn = exprCache[expr] = new Function('scope', 'with(scope){return (' + expr + ')}'); } catch (e) { fn = exprCache[expr] = () => undefined; } }
    try { return fn(scope); } catch (e) { return undefined; }
  }
  function interpolate(raw, scope) {
    if (raw === true) return true;
    if (raw.indexOf('{{') < 0) return raw;
    const whole = /^\{\{([\s\S]+)\}\}$/.exec(raw);
    if (whole && whole[1].indexOf('{{') < 0) return evaluate(whole[1], scope);
    return raw.replace(/\{\{([\s\S]+?)\}\}/g, (m, expr) => { const v = evaluate(expr, scope); return v === undefined || v === null ? '' : v; });
  }
  function renderNodes(nodes, scope, path) {
    const out = [];
    let chain = false;
    for (const node of nodes) {
      if (node.text !== undefined) { out.push({ key: path + '/' + node.id, text: String(interpolate(node.text, scope)) }); continue; }
      const attrs = node.attrs;
      if ('wx:if' in attrs) { chain = !!interpolate(attrs['wx:if'], scope); if (!chain) continue; }
      else if ('wx:elif' in attrs) { if (chain) continue; chain = !!interpolate(attrs['wx:elif'], scope); if (!chain) continue; }
      else if ('wx:else' in attrs) { if (chain) continue; chain = true; }
      if ('wx:for' in attrs) {
        const list = interpolate(attrs['wx:for'], scope) || [];
        const itemName = attrs['wx:for-item'] || 'item', indexName = attrs['wx:for-index'] || 'index', keyName = attrs['wx:key'];
        (Array.isArray(list) ? list : Object.values(list)).forEach((item, index) => {
          const inner = Object.create(scope);
          inner[itemName] = item; inner[indexName] = index;
          const key = keyName && keyName !== '*this' && item && typeof item === 'object' ? item[keyName] : keyName === '*this' ? item : index;
          out.push(...renderElement(node, inner, path + '[' + key + ']'));
        });
      } else out.push(...renderElement(node, scope, path));
    }
    return out;
  }
  function renderElement(node, scope, path) {
    if (node.tag === 'block') return renderNodes(node.children, scope, path + '/' + node.id);
    const vnode = { key: path + '/' + node.id, tag: node.tag, attrs: {}, events: {}, dataset: {}, children: null };
    for (const [name, raw] of Object.entries(node.attrs)) {
      if (name.startsWith('wx:')) continue;
      const event = /^(bind|catch):?([\w-]+)$/.exec(name);
      if (event) { vnode.events[event[2]] = { handler: raw, stop: event[1] === 'catch' }; continue; }
      const value = interpolate(raw, scope);
      if (name.startsWith('data-')) vnode.dataset[name.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = value;
      else vnode.attrs[name] = value;
    }
    vnode.children = renderNodes(node.children, scope, vnode.key);
    return [vnode];
  }

  // ---------------------------------------------------------------- DOM patching
  const truthy = v => v !== false && v !== undefined && v !== null && v !== 'false';
  function createElement(vnode, owner) {
    if (vnode.text !== undefined) return document.createTextNode(vnode.text);
    const el = document.createElement('wx-' + vnode.tag);
    const using = owner.using[vnode.tag];
    if (using) { el.__comp = createComponent(using, el, owner, vnode); }
    else if (builtins[vnode.tag] && builtins[vnode.tag].create) builtins[vnode.tag].create(el, owner);
    return el;
  }
  function updateElement(el, old, vnode, owner) {
    if (vnode.text !== undefined) { if (!old || old.text !== vnode.text) el.nodeValue = vnode.text; return; }
    const before = old ? old.attrs : {};
    for (const name of Object.keys(before)) if (!(name in vnode.attrs)) el.removeAttribute(name);
    for (const [name, value] of Object.entries(vnode.attrs)) {
      if (before[name] === value && old) continue;
      if (name === 'class') { const keep = [...el.classList].filter(c => c.startsWith('hx-')); el.className = String(value || '').trim(); keep.forEach(c => el.classList.add(c)); }
      else if (name === 'style') el.setAttribute('style', units(String(value || '')));
      else if (value === false || value === undefined || value === null) el.removeAttribute(name);
      else if (typeof value !== 'object') el.setAttribute(name, value === true ? '' : value);
    }
    el.__wx = { owner, events: vnode.events, dataset: vnode.dataset, attrs: vnode.attrs };
    if (el.__comp) { updateComponent(el.__comp, vnode); return; }
    const builtin = builtins[vnode.tag];
    if (builtin && builtin.leaf) { builtin.update(el, vnode, old, owner); return; }
    reconcile(el, old ? old.children : [], vnode.children, owner);
    if (builtin && builtin.update) builtin.update(el, vnode, old, owner);
  }
  function destroy(el) {
    if (el.nodeType !== 1) return;
    el.querySelectorAll('*').forEach(child => { if (child.__comp) detachComponent(child.__comp); });
    if (el.__comp) detachComponent(el.__comp);
  }
  function reconcile(parent, oldList, newList, owner) {
    const oldByKey = new Map();
    for (const old of oldList) oldByKey.set(old.key, old);
    newList.forEach(vnode => {
      const old = oldByKey.get(vnode.key);
      if (old && old.tag === vnode.tag && (old.text === undefined) === (vnode.text === undefined)) { vnode.el = old.el; oldByKey.delete(vnode.key); updateElement(vnode.el, old, vnode, owner); }
      else { vnode.el = createElement(vnode, owner); updateElement(vnode.el, null, vnode, owner); }
    });
    for (const old of oldByKey.values()) { destroy(old.el); if (old.el.parentNode === parent) parent.removeChild(old.el); }
    let cursor = parent.__firstManaged ? parent.__firstManaged() : parent.firstChild;
    for (const vnode of newList) {
      if (vnode.el !== cursor) parent.insertBefore(vnode.el, cursor); else cursor = cursor.nextSibling;
    }
  }

  // ---------------------------------------------------------------- built-in component shims
  const fire = (el, type, detail) => {
    const meta = el.__wx; if (!meta || !meta.events[type]) return;
    callHandler(meta.owner, meta.events[type].handler, { type, detail: detail || {}, currentTarget: { dataset: meta.dataset, id: el.id }, target: { dataset: meta.dataset, id: el.id } });
  };
  const builtins = {
    image: { leaf: true,
      create(el) { el.__img = new Image(); },
      update(el, vnode, old) {
        const src = vnode.attrs.src || '';
        const mode = vnode.attrs.mode || 'scaleToFill';
        el.style.backgroundSize = mode === 'aspectFill' ? 'cover' : mode === 'aspectFit' ? 'contain' : '100% 100%';
        // re-applied on every update: a bound style attribute replaces the inline style
        el.style.backgroundImage = src ? 'url("' + src + '")' : 'none';
        if (!old || old.attrs.src !== src) {
          if (src) { el.__img.onload = () => fire(el, 'load', { width: el.__img.naturalWidth, height: el.__img.naturalHeight }); el.__img.onerror = () => fire(el, 'error', { errMsg: 'load failed' }); el.__img.src = src; }
        }
      } },
    textarea: { leaf: true,
      create(el) {
        const field = el.__field = document.createElement('textarea');
        field.rows = 1; el.appendChild(field);
        const grow = () => { if (el.__auto) { field.style.height = '0px'; field.style.height = field.scrollHeight + 'px'; el.style.height = 'auto'; } };
        el.__grow = grow;
        field.addEventListener('input', () => { grow(); fire(el, 'input', { value: field.value, cursor: field.selectionStart }); });
        field.addEventListener('focus', () => { fire(el, 'focus', { value: field.value, height: harness.keyboard ? harness.keyboardHeight : 0 }); if (harness.keyboard) showKeyboard(el, true); });
        field.addEventListener('blur', () => { if (harness.holdKeyboard) return; fire(el, 'blur', { value: field.value }); showKeyboard(el, false); });
      },
      update(el, vnode) {
        const field = el.__field, attrs = vnode.attrs;
        el.__auto = truthy(attrs['auto-height']);
        if (attrs.value !== undefined && field.value !== String(attrs.value)) field.value = attrs.value;
        field.placeholder = attrs.placeholder || '';
        if (attrs.maxlength && Number(attrs.maxlength) > 0) field.maxLength = Number(attrs.maxlength);
        field.className = attrs['placeholder-class'] ? 'hx-ph-' + attrs['placeholder-class'] : '';
        el.__grow();
      } },
    input: { leaf: true,
      create(el) { const field = el.__field = document.createElement('input'); el.appendChild(field); field.addEventListener('input', () => fire(el, 'input', { value: field.value })); },
      update(el, vnode) { const field = el.__field; if (vnode.attrs.value !== undefined && field.value !== String(vnode.attrs.value)) field.value = vnode.attrs.value; field.placeholder = vnode.attrs.placeholder || ''; } },
    swiper: {
      update(el, vnode) {
        const items = [...el.children];
        let current = Number(vnode.attrs.current);
        if (!Number.isInteger(current)) current = el.__current || 0;
        el.__current = Math.min(Math.max(current, 0), Math.max(items.length - 1, 0));
        items.forEach((item, i) => item.classList.toggle('hx-current', i === el.__current));
      } },
    'scroll-view': {
      create(el) { el.addEventListener('scroll', () => fire(el, 'scroll', { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, scrollLeft: 0, deltaY: 0 })); },
      update(el, vnode, old) {
        const top = vnode.attrs['scroll-top'];
        if (top !== undefined && (!old || old.attrs['scroll-top'] !== top)) {
          const apply = () => el.scrollTo({ top: Number(top), behavior: truthy(vnode.attrs['scroll-with-animation']) && !harness.instantScroll ? 'smooth' : 'auto' });
          apply(); requestAnimationFrame(apply);
        }
      } },
    'page-container': { leaf: true, update(el, vnode) { el.__shown = truthy(vnode.attrs.show); } },
    // page-meta: only page-style "overflow:hidden" is emulated (locks the page scroller).
    'page-meta': { leaf: true, update(el, vnode) {
      const frame = el.closest('.wx-page');
      if (frame) frame.style.overflowY = /overflow\s*:\s*hidden/.test(String(vnode.attrs['page-style'] || '')) ? 'hidden' : '';
    } },
    button: { update(el, vnode) { el.classList.toggle('hx-disabled', truthy(vnode.attrs.disabled)); } }
  };
  function showKeyboard(el, visible) {
    const height = visible ? harness.keyboardHeight : 0;
    if (shell) shell.keyboard(height);
    fire(el, 'keyboardheightchange', { height, duration: 0.25 });
  }
  harness.blur = () => { harness.holdKeyboard = false; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

  // ---------------------------------------------------------------- events
  function callHandler(owner, name, event) {
    const fn = owner.instance[name];
    if (typeof fn === 'function') return fn.call(owner.instance, event);
    console.warn('Harness: missing handler ' + name);
  }
  function dispatchBubbling(type, start, detail) {
    for (let el = start; el && el !== document.body; el = el.parentNode) {
      const meta = el.__wx;
      if (!meta) continue;
      if (type === 'tap' && el.classList.contains('hx-disabled')) return;
      const spec = meta.events[type];
      if (!spec) continue;
      callHandler(meta.owner, spec.handler, { type, detail: detail || {}, currentTarget: { dataset: meta.dataset, id: el.id }, target: { dataset: (start.__wx || meta).dataset, id: start.id } });
      if (spec.stop) return;
    }
  }
  document.addEventListener('click', e => dispatchBubbling('tap', e.target, { x: e.clientX, y: e.clientY }));
  const hoverOf = el => { for (; el && el !== document.body; el = el.parentNode) if (el.__wx && el.__wx.attrs['hover-class'] && el.__wx.attrs['hover-class'] !== 'none') return el; return null; };
  document.addEventListener('pointerdown', e => { const el = hoverOf(e.target); if (el) { el.classList.add(el.__wx.attrs['hover-class']); el.__hover = el.__wx.attrs['hover-class']; } });
  document.addEventListener('pointerup', () => document.querySelectorAll('*').forEach(el => { if (el.__hover) { const c = el.__hover; el.__hover = null; setTimeout(() => el.classList.remove(c), 80); } }));
  // Touch events: a mouse or pen pointer is reported as one finger to the nearest
  // element that binds touchstart (the companion, the panorama canvas).
  let touchTarget = null;
  function touchEvent(type, e, el, ended) {
    const meta = el.__wx, spec = meta && meta.events[type];
    if (!spec) return;
    const point = { identifier: 0, clientX: e.clientX, clientY: e.clientY, pageX: e.pageX, pageY: e.pageY };
    callHandler(meta.owner, spec.handler, { type, detail: {}, touches: ended ? [] : [point], changedTouches: [point], currentTarget: { dataset: meta.dataset, id: el.id }, target: { dataset: meta.dataset, id: el.id } });
  }
  document.addEventListener('pointerdown', e => {
    for (let el = e.target; el && el !== document.body; el = el.parentNode) if (el.__wx && el.__wx.events.touchstart) { touchTarget = el; touchEvent('touchstart', e, el, false); e.preventDefault(); break; }
  });
  document.addEventListener('pointermove', e => { if (touchTarget) touchEvent('touchmove', e, touchTarget, false); });
  document.addEventListener('pointerup', e => { if (!touchTarget) return; const el = touchTarget; touchTarget = null; touchEvent('touchend', e, el, true); });
  document.addEventListener('pointercancel', e => { if (!touchTarget) return; const el = touchTarget; touchTarget = null; touchEvent('touchcancel', e, el, true); });
  // catchtouchmove blocks page scroll-through from the element that carries it.
  // (On real devices it can also block a scroll-view below it, so the guide layer
  // only puts it on parts that never scroll; this harness cannot show that.)
  document.addEventListener('wheel', e => {
    let insideScroll = false;
    for (let el = e.target; el && el !== document.body; el = el.parentNode) {
      if (el.tagName === 'WX-SCROLL-VIEW') insideScroll = true;
      if (el.__wx && el.__wx.events.touchmove && el.__wx.events.touchmove.stop) { if (!insideScroll) e.preventDefault(); return; }
    }
  }, { passive: false });

  // ---------------------------------------------------------------- instances
  function setPath(target, key, value) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let ref = target;
    for (let i = 0; i < parts.length - 1; i++) { if (ref[parts[i]] === undefined || ref[parts[i]] === null) ref[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; ref = ref[parts[i]]; }
    ref[parts[parts.length - 1]] = value;
  }
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function makeOwner(base, container, instance) {
    const json = files[base + '.json'] ? JSON.parse(files[base + '.json']) : {};
    const using = {};
    for (const [tag, target] of Object.entries(Object.assign({}, appJson.usingComponents || {}, json.usingComponents || {}))) using[tag] = resolvePath(base.slice(0, base.lastIndexOf('/') + 1), target);
    const owner = { base, container, instance, using, template: parseWxml(files[base + '.wxml'] || ''), vnodes: [], children: new Set(), json };
    owner.render = () => {
      const next = renderNodes(owner.template, instance.data, base);
      reconcile(container, owner.vnodes, next, owner);
      owner.vnodes = next;
    };
    instance.setData = function (patch, callback) {
      for (const [key, value] of Object.entries(patch || {})) setPath(instance.data, key, clone(value));
      if (!owner.dead) owner.render();
      if (callback) callback.call(instance);
    };
    instance.selectComponent = selector => { const el = container.querySelector(selector); return el && el.__comp ? el.__comp.instance : null; };
    instance.createSelectorQuery = () => selectorQuery(container);
    return owner;
  }
  function selectorQuery(scope) {
    const jobs = [];
    const query = {
      in() { return query; },
      select(selector) { const el = (scope || document).querySelector(selector); return { boundingClientRect(cb) { jobs.push(() => { const r = el && el.getBoundingClientRect(); cb && cb(r ? { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null); }); return query; } }; },
      exec(done) { jobs.forEach(job => job()); done && done(); }
    };
    return query;
  }
  const componentDefs = {}, pageDefs = {};
  let registering = null;
  window.Component = def => { componentDefs[registering] = def; };
  window.Page = def => { pageDefs[registering] = def; };
  window.App = def => { harness.app = def; };
  window.getApp = () => harness.app;
  function definitionOf(base, table) {
    if (!table[base]) { registering = base; requireFrom('', base + '.js'); registering = null; }
    return table[base];
  }
  function createComponent(base, host, parent, vnode) {
    const def = definitionOf(base, componentDefs);
    ensureStyle(base, '');
    const instance = { data: clone(def.data || {}), properties: {} };
    const owner = makeOwner(base, host, instance);
    owner.def = def; owner.parent = parent; owner.page = parent.page || parent;
    owner.page.components.add(owner);
    for (const [name, spec] of Object.entries(def.properties || {})) instance.data[name] = spec && typeof spec === 'object' && 'value' in spec ? clone(spec.value) : undefined;
    for (const [name, fn] of Object.entries(def.methods || {})) instance[name] = fn;
    instance.triggerEvent = (name, detail) => { const meta = host.__wx; const spec = meta && meta.events[name]; if (spec) callHandler(meta.owner, spec.handler, { type: name, detail, currentTarget: { dataset: meta.dataset, id: host.id }, target: { dataset: meta.dataset, id: host.id } }); };
    const life = def.lifetimes || {};
    owner.life = name => { const fn = life[name] || def[name]; if (fn) fn.call(instance); };
    owner.life('created');
    owner.fresh = true;
    host.__firstManaged = null;
    return owner;
  }
  function updateComponent(owner, vnode) {
    const def = owner.def, instance = owner.instance;
    const changed = [];
    for (const name of Object.keys(def.properties || {})) {
      const attr = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      if (!(attr in vnode.attrs)) continue;
      const value = vnode.attrs[attr];
      if (JSON.stringify(instance.data[name]) !== JSON.stringify(value)) { changed.push([name, instance.data[name]]); instance.data[name] = clone(value); }
    }
    if (owner.fresh) {
      owner.fresh = false;
      owner.life('attached');
      owner.render();
      Promise.resolve().then(() => { if (!owner.dead) owner.life('ready'); });
      return;
    }
    if (!changed.length) return;
    owner.render();
    for (const [name, previous] of changed) {
      const observer = def.properties[name] && def.properties[name].observer;
      if (typeof observer === 'string') instance[observer](instance.data[name], previous); else if (typeof observer === 'function') observer.call(instance, instance.data[name], previous);
    }
  }
  function detachComponent(owner) { if (owner.dead) return; owner.dead = true; owner.life('detached'); owner.page.components.delete(owner); }

  // ---------------------------------------------------------------- pages and navigation
  const stack = [];
  const tabs = (appJson.tabBar && appJson.tabBar.list || []).map(t => t.pagePath);
  const tabPages = {};
  const world = document.getElementById('world');
  // A page being created is already on the page stack for its components (as in WeChat).
  let pendingPage = null, pendingOwner = null;
  window.getCurrentPages = () => stack.map(owner => owner.instance).concat(pendingPage ? [pendingPage] : []);
  function createPage(route, options) {
    const def = definitionOf(route, pageDefs);
    const container = document.createElement('div');
    container.className = 'wx-page';
    container.dataset.route = route;
    world.appendChild(container);
    ensureStyle(route, '.wx-page[data-route="' + route + '"]');
    const rootEl = document.createElement('div');
    rootEl.className = 'wx-page-body';
    container.appendChild(rootEl);
    const instance = { route, __route__: route, options: options || {}, data: clone(def.data || {}) };
    for (const [name, value] of Object.entries(def)) if (typeof value === 'function') instance[name] = value;
    const owner = makeOwner(route, rootEl, instance);
    owner.page = owner; owner.components = new Set(); owner.route = route; owner.frame = container;
    instance.selectComponent = selector => { const el = container.querySelector(selector); return el && el.__comp ? el.__comp.instance : null; };
    instance.createSelectorQuery = () => selectorQuery(container);
    if (tabs.includes(route) && appJson.tabBar.custom) {
      const host = document.createElement('wx-custom-tab-bar');
      container.appendChild(host);
      const fake = { using: { 'custom-tab-bar': 'custom-tab-bar/index' }, page: owner, instance };
      const bar = createComponent('custom-tab-bar/index', host, fake, {});
      host.__comp = bar; host.__wx = { owner, events: {}, dataset: {}, attrs: {} };
      updateComponent(bar, { attrs: {} });
      instance.getTabBar = () => bar.instance;
    }
    pendingPage = instance; pendingOwner = owner;
    try { if (instance.onLoad) instance.onLoad(options || {}); owner.render(); } finally { pendingPage = null; pendingOwner = null; }
    return owner;
  }
  function pageLife(owner, name) {
    const method = name === 'show' ? 'onShow' : 'onHide';
    if (owner.instance[method]) owner.instance[method]();
    owner.components.forEach(c => { const fn = c.def.pageLifetimes && c.def.pageLifetimes[name]; if (fn) fn.call(c.instance); });
  }
  function present() {
    const top = stack[stack.length - 1];
    document.querySelectorAll('.wx-page').forEach(el => el.classList.toggle('hx-top', el === top.frame));
    const json = top.json;
    const win = Object.assign({}, appJson.window, json);
    top.title = top.title || win.navigationBarTitleText || '';
    document.documentElement.style.background = win.backgroundColor || '#fff';
    if (shell) shell.nav({ title: top.title, back: stack.length > 1, background: win.navigationBarBackgroundColor || '#fff', dark: win.navigationBarTextStyle !== 'white', tab: tabs.includes(top.route) });
  }
  function parseUrl(url) {
    const [pathname, query] = url.replace(/^\//, '').split('?');
    const options = {};
    (query || '').split('&').filter(Boolean).forEach(pair => { const [k, v] = pair.split('='); options[k] = decodeURIComponent(v || ''); });
    return { route: pathname, options };
  }
  const nav = {
    navigateTo(o) { const { route, options } = parseUrl(o.url); pageLife(stack[stack.length - 1], 'hide'); const page = createPage(route, options); stack.push(page); present(); pageLife(page, 'show'); if (page.instance.onReady) page.instance.onReady(); harness.log.push('navigateTo ' + o.url); },
    navigateBack() {
      if (stack.length < 2) return;
      const page = stack.pop();
      pageLife(page, 'hide'); if (page.instance.onUnload) page.instance.onUnload();
      page.components.forEach(detachComponent); page.dead = true; page.frame.remove();
      present(); pageLife(stack[stack.length - 1], 'show'); harness.log.push('navigateBack');
    },
    switchTab(o) {
      const { route } = parseUrl(o.url);
      while (stack.length > 1) { const page = stack.pop(); if (page.instance.onUnload) page.instance.onUnload(); page.frame.remove(); }
      const current = stack[0];
      if (current && current.route === route) { present(); return; }
      if (current) pageLife(current, 'hide');
      const fresh = !tabPages[route];
      const page = tabPages[route] || (tabPages[route] = createPage(route, {}));
      stack[0] = page; present(); pageLife(page, 'show');
      if (fresh && page.instance.onReady) page.instance.onReady();
      harness.log.push('switchTab ' + o.url);
    },
    redirectTo(o) { nav.navigateBack(); nav.navigateTo(o); }
  };
  // The hardware / gesture back: a shown page-container swallows it, as in WeChat.
  harness.back = () => {
    const top = stack[stack.length - 1];
    const container = [...top.frame.querySelectorAll('wx-page-container')].find(el => el.__shown);
    if (container) { fire(container, 'beforeleave'); fire(container, 'leave'); fire(container, 'afterleave'); return 'container'; }
    if (stack.length > 1) { nav.navigateBack(); return 'page'; }
    return 'exit';
  };
  const appShowListeners = [];
  harness.appHide = () => pageLife(stack[stack.length - 1], 'hide');
  harness.appShow = () => { appShowListeners.forEach(fn => fn({})); pageLife(stack[stack.length - 1], 'show'); };
  harness.pet = () => { const el = stack[stack.length - 1].frame.querySelector('wx-village-pet'); return el && el.__comp ? el.__comp.instance : null; };
  harness.top = () => stack[stack.length - 1];
  harness.agent = () => { const el = stack[stack.length - 1].frame.querySelector('wx-guide-agent'); return el && el.__comp.instance; };

  // ---------------------------------------------------------------- wx shim
  const storage = {};
  function toast(text) { const el = document.createElement('div'); el.className = 'hx-toast'; el.textContent = text; document.body.appendChild(el); setTimeout(() => el.remove(), 1800); }
  function request(options) {
    harness.requests.push({ url: options.url, at: Date.now(), mode: harness.net });
    let chunkHandler = null, aborted = false;
    const controller = new AbortController();
    const fail = errMsg => { if (!aborted) options.fail && options.fail({ errMsg }); };
    if (harness.net === 'offline') setTimeout(() => fail('request:fail net::ERR_INTERNET_DISCONNECTED'), 350);
    else if (harness.net === 'hang') { /* never answers: exercises the watchdog */ }
    else {
      const header = Object.assign({}, options.header);
      fetch('/__proxy', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-target-url': options.url, 'x-forward-auth': header.Authorization ? '1' : '0' }, body: JSON.stringify(options.data) })
        .then(async res => {
          const reader = res.body.getReader();
          const parts = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (options.enableChunked && chunkHandler) chunkHandler({ data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }); else parts.push(value);
          }
          let data = '';
          if (parts.length) { const text = new TextDecoder().decode(await new Blob(parts).arrayBuffer()); data = text; if (options.dataType === 'json') { try { data = JSON.parse(text); } catch (e) {} } }
          if (!aborted) options.success && options.success({ statusCode: res.status, data, header: {} });
        })
        .catch(error => fail(aborted ? 'request:fail abort' : 'request:fail ' + error.message));
    }
    return { abort() { if (aborted) return; options.fail && options.fail({ errMsg: 'request:fail abort' }); aborted = true; controller.abort(); }, onChunkReceived(fn) { chunkHandler = fn; }, onHeadersReceived() {} };
  }
  window.wx = Object.assign({
    env: { USER_DATA_PATH: '/harness' },
    getStorageSync: key => clone(storage[key]), setStorageSync: (key, value) => { storage[key] = clone(value); },
    showToast: o => toast(o.title), hideToast() {}, showLoading() {}, hideLoading() {},
    showModal: o => { toast((o.title || '') + ' ' + (o.content || '')); o.success && o.success({ confirm: true, cancel: false }); },
    setNavigationBarTitle: o => { if (pendingOwner) { pendingOwner.title = o.title; return; } stack[stack.length - 1].title = o.title; if (shell) shell.title(o.title); },
    setNavigationBarColor() {}, hideKeyboard: () => harness.blur(),
    pageScrollTo: o => { const frame = stack[stack.length - 1].frame; const target = o.selector ? frame.querySelector(o.selector) : null; frame.scrollTo({ top: target ? target.offsetTop : o.scrollTop || 0, behavior: 'smooth' }); },
    createSelectorQuery: () => selectorQuery(stack[stack.length - 1].frame),
    getFileSystemManager() { throw new Error('not available in the preview harness'); },
    getSystemInfoSync: () => ({ windowWidth: innerWidth, windowHeight: innerHeight, pixelRatio: devicePixelRatio }),
    // the drawn status and navigation bars are 91 px; the emulated bottom safe area is 34 px
    getWindowInfo: () => ({ windowWidth: innerWidth, windowHeight: innerHeight, screenHeight: innerHeight + 91, safeArea: { bottom: innerHeight + 91 - 34 }, pixelRatio: devicePixelRatio }),
    vibrateShort: () => { harness.log.push('vibrateShort'); }, onAppShow: fn => { appShowListeners.push(fn); }, onAppHide() {},
    getImageInfo: o => { const img = new Image(); img.onload = () => o.success && o.success({ width: img.naturalWidth, height: img.naturalHeight, path: o.src }); img.onerror = () => o.fail && o.fail({ errMsg: 'getImageInfo:fail' }); img.src = o.src; },
    request, setClipboardData() {}, chooseMedia() {}, canIUse: () => true, nextTick: fn => Promise.resolve().then(fn)
  }, nav);

  // ---------------------------------------------------------------- boot
  requireFrom('', 'app.js');
  if (harness.app && harness.app.onLaunch) harness.app.onLaunch.call(harness.app);
  const first = new URLSearchParams(location.search).get('page') || appJson.pages[0];
  if (tabs.includes(first)) nav.switchTab({ url: '/' + first });
  else { nav.switchTab({ url: '/' + tabs[0] }); nav.navigateTo({ url: '/' + first + location.search.replace(/^\?page=[^&]*&?/, '?') }); }
  harness.ready = true;
})();
