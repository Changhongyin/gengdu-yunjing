// Provider adapter for the village guide.
// Native mini-program networking only: wx.request, optional chunked transfer,
// hand-written UTF-8 and SSE parsing. No fetch, DOM, TextDecoder or Node APIs.
const configStore = require('./guide-config');

// Binary bodies are recognized by tag, not by instanceof: a buffer handed over by
// the host (notably in WeChat DevTools) can come from another JavaScript realm.
function isBuffer(value) {
  if (!value || typeof value !== 'object') return false;
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object Uint8Array]';
}
// Incremental UTF-8 decoder: multi-byte characters may be split across chunks.
function createUtf8Decoder() {
  let pending = [];
  return {
    push(buffer) {
      const bytes = pending.concat(Array.prototype.slice.call(new Uint8Array(buffer)));
      let out = '', i = 0;
      while (i < bytes.length) {
        const b = bytes[i];
        const need = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
        if (i + need > bytes.length) break;
        let code;
        if (need === 1) code = b < 0x80 ? b : 0xfffd;
        else if (need === 2) code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        else if (need === 3) code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        else code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
        if (code > 0xffff) { code -= 0x10000; out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff)); }
        else out += String.fromCharCode(code);
        i += need;
      }
      pending = bytes.slice(i);
      return out;
    }
  };
}

// Server-sent events: emits the payload of each complete "data:" line.
function createSseParser(onData) {
  let buffer = '';
  return {
    feed(text) {
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.indexOf('data:') === 0) onData(line.slice(5).trim());
      }
    },
    rest() { return buffer; }
  };
}

const messages = {
  auth: ['讲解服务的密钥未通过验证', '请检查配置中的 API Key 是否有效。'],
  quota: ['讲解服务的账户额度不足', '服务商以账户额度不足为由拒绝了请求。部分服务商的免费模型也只对已充值的账户开放，请在服务商控制台确认账户状态。'],
  forbidden: ['讲解服务拒绝了这次请求', '当前密钥可能没有使用该模型的权限。'],
  model: ['指定的讲解模型暂不可用', '服务商没有找到该模型，或该模型暂时没有可用线路。'],
  rate: ['问的人有点多', '触发了服务商的频率限制，请稍等片刻再试。'],
  server: ['讲解服务暂时出了点状况', '服务商返回了服务器错误，请稍后重试。'],
  timeout: ['等了很久，还没有回音', '请求超时，请检查网络后重试。'],
  network: ['网络没有连上', '请检查网络连接后重试。'],
  domain: ['请求域名尚未加入白名单', '需要在小程序后台把讲解服务域名加入 request 合法域名。'],
  empty: ['这次没有收到讲解内容', '服务返回了空的回答，请重试。'],
  cancelled: ['已停止', ''],
  config: ['讲解服务尚未配置', '当前没有可用的在线讲解配置。']
};
function failure(kind, extra) {
  const text = messages[kind] || messages.server;
  return Object.assign({ kind, title: text[0], detail: text[1], retryable: !['cancelled', 'config'].includes(kind) }, extra || {});
}
function parseBody(body) {
  if (!body) return null;
  if (typeof body === 'object' && !isBuffer(body)) return body;
  let text = body;
  if (isBuffer(body)) text = createUtf8Decoder().push(body);
  try { return JSON.parse(text); } catch (error) { return null; }
}
// Maps an HTTP status, provider error body or wx.request failure to one failure.
function classify(result) {
  const errMsg = String(result.errMsg || '');
  if (!result.statusCode) {
    if (/abort/i.test(errMsg)) return failure('cancelled');
    if (/domain list|合法域名|not in domain/i.test(errMsg)) return failure('domain', { providerMessage: errMsg });
    if (/time\s?out|超时/i.test(errMsg)) return failure('timeout', { providerMessage: errMsg });
    return failure('network', { providerMessage: errMsg });
  }
  const json = parseBody(result.body);
  const error = json && json.error || {};
  const code = String(error.code || error.type || '');
  const providerMessage = String(error.message || '').slice(0, 200);
  const extra = { status: result.statusCode, code, providerMessage };
  const status = result.statusCode;
  if (/insufficient.*quota|quota|balance|余额|额度/i.test(code + providerMessage) || status === 402) return failure('quota', extra);
  if (status === 401 || /invalid.*(api)?.?key|unauthorized|令牌|token.*(invalid|expired)/i.test(code + providerMessage)) return failure('auth', extra);
  if (status === 404 || /model.*not.*(found|exist)|no available channel|无可用渠道|模型.*不存在/i.test(code + providerMessage)) return failure('model', extra);
  if (status === 429) return failure('rate', extra);
  if (status === 403) return failure('forbidden', extra);
  if (status === 408 || status === 504) return failure('timeout', extra);
  if (status >= 500) return failure('server', extra);
  return failure('server', extra);
}

function endpoint(config) {
  if (config.mode === 'live-relay') return config.relayUrl;
  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
}
function buildRequest(config, chatMessages, stream) {
  const header = { 'Content-Type': 'application/json' };
  if (config.mode === 'live-direct') header.Authorization = 'Bearer ' + config.apiKey;
  const data = { messages: chatMessages, stream, temperature: config.temperature, max_tokens: config.maxTokens };
  // The relay pins the model and holds the key; the client never sends either.
  if (config.mode === 'live-direct') data.model = config.model;
  return { url: endpoint(config), header, data };
}
function contentOf(json) {
  const choice = json && json.choices && json.choices[0];
  if (!choice) return { text: '', finish: '' };
  const text = choice.delta ? choice.delta.content : choice.message && choice.message.content;
  return { text: typeof text === 'string' ? text : '', finish: choice.finish_reason || '' };
}

// Starts one chat request. Exactly one of onDone / onError is called, once.
// Returns { abort() }. transport defaults to wx.request and is injectable for tests.
function chat(options, transport) {
  const config = options.config || configStore.get();
  const send = transport || wx.request;
  if (config.mode === 'demo') {
    setTimeout(() => options.onError(failure('config')), 0);
    return { abort() {} };
  }
  if (config.protocol !== 'chat_completions') {
    setTimeout(() => options.onError(failure('config', { providerMessage: 'Unsupported protocol ' + config.protocol })), 0);
    return { abort() {} };
  }
  const stream = config.stream !== false;
  const request = buildRequest(config, options.messages, stream);
  const decoder = createUtf8Decoder();
  let settled = false, received = '', raw = '', finish = '', streamError = null, watchdog = null, task = null, timedOut = false;
  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  const settle = (error) => {
    if (settled) return;
    settled = true;
    clearWatchdog();
    if (error) options.onError(Object.assign(error, { partial: received }));
    else options.onDone({ text: received, truncated: finish === 'length', model: config.model });
  };
  const parser = createSseParser(payload => {
    if (!payload || payload === '[DONE]') return;
    let json;
    try { json = JSON.parse(payload); } catch (error) { return; }
    if (json.error) { streamError = { statusCode: 500, body: json }; return; }
    const piece = contentOf(json);
    if (piece.finish) finish = piece.finish;
    if (piece.text) { received += piece.text; if (options.onDelta) options.onDelta(piece.text, received); }
  });
  const consume = text => { raw += text; parser.feed(text); };
  const armWatchdog = ms => {
    clearWatchdog();
    watchdog = setTimeout(() => { timedOut = true; try { task && task.abort(); } catch (error) {} settle(failure('timeout')); }, ms);
  };
  armWatchdog(config.firstByteTimeoutMs);
  task = send({
    url: request.url, method: 'POST', header: request.header, data: request.data,
    timeout: config.timeoutMs, enableChunked: stream, responseType: stream ? 'arraybuffer' : 'text', dataType: stream ? 'text' : 'json',
    success(res) {
      if (settled) return;
      // Platforms without chunk callbacks deliver the whole body here.
      if (res.data && !raw) {
        if (isBuffer(res.data)) consume(decoder.push(res.data) + '\n');
        else if (typeof res.data === 'string') consume(res.data + '\n');
        else raw = JSON.stringify(res.data);
      } else if (raw) {
        parser.feed('\n'); // flush a last event that arrived without its line ending
      }
      if (res.statusCode !== 200) return settle(classify({ statusCode: res.statusCode, body: parseBody(raw) || raw }));
      if (streamError) return settle(classify(streamError));
      if (!received) {
        const json = parseBody(raw);
        if (json && json.error) return settle(classify({ statusCode: 500, body: json }));
        const whole = contentOf(json);
        if (whole.text) { received = whole.text; finish = whole.finish; if (options.onDelta) options.onDelta(whole.text, received); }
      }
      settle(received ? null : failure('empty'));
    },
    fail(error) {
      if (settled) return;
      settle(timedOut ? failure('timeout') : classify({ errMsg: error && error.errMsg }));
    }
  });
  if (stream && task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived(res => {
      if (settled || !res || !res.data) return;
      armWatchdog(config.firstByteTimeoutMs);
      consume(decoder.push(res.data));
    });
  } else if (!settled) {
    // No chunk callbacks (non-stream mode, or a base library older than 2.20.1):
    // the whole body arrives in success(), so only the total timeout applies.
    armWatchdog(config.timeoutMs + 2000);
  }
  return {
    abort() {
      if (settled) return;
      settled = true;
      clearWatchdog();
      try { task && task.abort(); } catch (error) {}
      options.onError(Object.assign(failure('cancelled'), { partial: received }));
    }
  };
}
module.exports = { chat, classify, createUtf8Decoder, createSseParser, buildRequest, endpoint, failure, isBuffer };
