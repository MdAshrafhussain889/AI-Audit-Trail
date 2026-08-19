const DOMAIN_MAP = {
  'copilot.microsoft.com': 'Microsoft Copilot',
  'github.com': 'GitHub Copilot',
  'claude.ai': 'Claude (Anthropic)',
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT'
};

const MONITORED = /^(https?):\/\/((copilot\.microsoft\.com|claude\.ai|chat\.openai\.com|chatgpt\.com)(\/|$)|github\.com\/.*copilot)/i;
const CHAT_WS = /(\/c\/|\/c\/api\/chat|\/backend-api|\/api\/turing|conversation|\/ws\b)/i;

const ATTACHED = new Set();
const WS_URLS = new Map();
const PENDING_FETCH = new Map();
const PENDING_WS = new Map();

const DIAG = { wsCreated: 0, sent: 0, recv: 0, inputs: 0, captures: 0, lastPreview: '' };

let lastCaptureAt = 0;
let lastError = '';

// Get backend URL from chrome storage or default to localhost
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('backendUrl', (result) => {
      resolve(result.backendUrl || 'http://localhost:8000');
    });
  });
}

function getDomainLabel(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    if (hostname in DOMAIN_MAP) return DOMAIN_MAP[hostname];
    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      if (urlObj.pathname.includes('copilot')) return DOMAIN_MAP['github.com'];
    }
  } catch (e) {}
  return null;
}

function isChatRequest(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.includes('chat_conversations') && path.includes('completion')) return true;
    if (u.hostname.includes('copilot') && path.includes('chat')) return true;
    // ChatGPT web client posts to various paths (backend-api, /c/<id>/..., /conversation)
    if ((u.hostname.includes('openai') || u.hostname.includes('chatgpt')) && (path.includes('/backend-api') || path.includes('/c/') || path.includes('/conversation'))) return true;
  } catch (e) {}
  return false;
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') parts.push(part);
      else if (typeof part.text === 'string') parts.push(part.text);
    }
    return parts.join(' ').trim();
  }
  return '';
}

function extractInputAndModel(body) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  let inputText = '';
  if (typeof parsed.prompt === 'string' && parsed.prompt) {
      inputText = parsed.prompt;
  }

  const findUserMessage = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return;
    if (Array.isArray(obj)) {
      for (const item of obj) findUserMessage(item, depth + 1);
      return;
    }
    const role = obj.role || (obj.author && obj.author.role);
    if (role === 'user' && obj.content) {
       if (Array.isArray(obj.content.parts)) {
         const text = obj.content.parts.map(p => typeof p === 'string' ? p : (p && p.text ? p.text : '')).join('\n').trim();
         if (text && !inputText) inputText = text;
       } else {
         const text = textFromContent(obj.content);
         if (text && !inputText) inputText = text;
       }
    } else {
      for (const val of Object.values(obj)) findUserMessage(val, depth + 1);
    }
  };

  if (!inputText) findUserMessage(parsed);

  return { inputText, model: typeof parsed.model === 'string' ? parsed.model : '' };
}

function parseSSE(body) {
  const events = [];
  let current = null;
  const lines = body.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '') {
      if (current) {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith('event:')) {
      if (!current) current = { name: '', data: [] };
      current.name = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      if (!current) current = { name: '', data: [] };
      current.data.push(line.slice(5).trim());
      continue;
    }
  }
  if (current) events.push(current);
  return events;
}

function parseChatGPTSse(body) {
  let outputText = '';
  let model = '';

  const processJson = (parsed) => {
    if (!parsed || typeof parsed !== 'object') return;
    
    if (parsed.choices && parsed.choices[0]) {
      const c = parsed.choices[0];
      if (c.delta && typeof c.delta.content === 'string') {
        outputText += c.delta.content;
      } else if (c.message && typeof c.message.content === 'string') {
        if (c.message.content.length > outputText.length) outputText = c.message.content;
      }
    }

    const msg = parsed.message || parsed.item || parsed;
    if (msg) {
      const role = msg.role || (msg.author && msg.author.role);
      if (role === 'assistant') {
        if (msg.content && Array.isArray(msg.content.parts)) {
          const parts = msg.content.parts.map(p => typeof p === 'string' ? p : (p && p.text ? p.text : ''));
          const joined = parts.join('').trim();
          if (joined && joined.length >= outputText.length) outputText = joined;
        } else if (msg.content && typeof msg.content.text === 'string') {
          if (msg.content.text.length >= outputText.length) outputText = msg.content.text;
        } else if (typeof msg.content === 'string') {
          if (msg.content.length >= outputText.length) outputText = msg.content;
        }
      }
    }

    const meta = (msg && msg.metadata) || parsed.metadata;
    if (meta) {
      const m = meta.resolved_model_slug || meta.model_slug || meta.slug || meta.model;
      if (typeof m === 'string' && m) model = m;
    }
  };

  try {
    processJson(JSON.parse(body));
    if (outputText) return { outputText, model };
  } catch (e) {}

  for (const evt of parseSSE(body)) {
    const jsonStr = evt.data.join('\n');
    if (!jsonStr || jsonStr === '[DONE]') continue;
    try {
      processJson(JSON.parse(jsonStr));
    } catch (e) {}
  }
  console.log('[audit-debug] parseChatGPTSse output length:', outputText.length, 'model:', model);
  return { outputText, model };
}

function parseCopilotSSE(body) {
  let outputText = '';
  let model = '';
  for (const evt of parseSSE(body)) {
    const json = evt.data.join('\n');
    if (!json) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      continue;
    }
    if (parsed.type === 3 && parsed.evt) {
      const inner = parsed.evt;
      if (Array.isArray(inner.tokens)) {
        outputText += inner.tokens.filter((t) => typeof t === 'string').join('');
      }
      if (typeof inner.model === 'string' && inner.model) model = inner.model;
    }
    if (parsed.message && typeof parsed.message.content === 'string' && parsed.message.content) {
      outputText = parsed.message.content;
      if (typeof parsed.message.model === 'string' && parsed.message.model) model = parsed.message.model;
    }
  }
  return { outputText, model };
}

function parseClaudeSSE(body) {
  let outputText = '';
  let model = '';
  for (const evt of parseSSE(body)) {
    const json = evt.data.join('\n');
    if (!json) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      continue;
    }
    if (parsed.completion && typeof parsed.completion === 'string') {
      outputText += parsed.completion;
    }
    if (parsed.delta && typeof parsed.delta.text === 'string') {
      outputText += parsed.delta.text;
    }
    if (parsed.message && parsed.message.model) {
      model = parsed.message.model;
    } else if (parsed.model) {
      model = parsed.model;
    }
  }
  return { outputText, model };
}

function extractGeminiInput(postData) {
  try {
    const decoded = decodeURIComponent(postData.replace(/^f\.req=/, ''));
    const outer = JSON.parse(decoded);
    const payloadStr =
      outer && outer[0] && outer[0][0] && typeof outer[0][0][2] === 'string' ? outer[0][0][2] : '';
    if (!payloadStr) return '';
    let payload = null;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      return '';
    }
    if (!payload || typeof payload !== 'object') return '';
    if (Array.isArray(payload['5']) && Array.isArray(payload['5'][0])) {
      const s = payload['5'][0]
        .filter((x) => typeof x === 'string' && x)
        .join(' ')
        .trim();
      if (s) return s;
    }
    if (typeof payload['4'] === 'string' && payload['4'].trim()) return payload['4'].trim();
  } catch (e) {}
  return '';
}

function parseGeminiResponse(body) {
  const result = { inputText: '', outputText: '', model: '' };
  const trimmed = body.replace(/^\s*\)\]\}'\s*\n?/, '');
  let outer = null;
  try {
    outer = JSON.parse(trimmed);
  } catch (e) {
    return result;
  }

  const capture = (node) => {
    if (typeof node === 'string') {
      if (node.length > 3 && node[0] === '[') {
        try {
          capture(JSON.parse(node));
        } catch (e) {}
      }
      return;
    }
    if (!Array.isArray(node)) return;
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (v === 'generation' && i + 1 < node.length && typeof node[i + 1] === 'string') {
        if (!result.outputText && node[i + 1]) result.outputText = node[i + 1];
      } else if (v === 'initial_query' && i + 1 < node.length && typeof node[i + 1] === 'string') {
        if (!result.inputText && node[i + 1]) result.inputText = node[i + 1];
      } else if (v === 'model_id' && i + 1 < node.length && typeof node[i + 1] === 'string') {
        if (!result.model && node[i + 1]) result.model = node[i + 1];
      } else if (Array.isArray(v)) {
        capture(v);
      } else if (typeof v === 'string' && v.startsWith('[')) {
        try {
          capture(JSON.parse(v));
        } catch (e) {}
      }
    }
  };
  capture(outer);
  return result;
}

function attachDebugger(tabId) {
  if (ATTACHED.has(tabId)) return;
  chrome.debugger.attach({ tabId }, '1.3', () => {
    if (chrome.runtime.lastError) {
      lastError = 'attach: ' + chrome.runtime.lastError.message;
      return;
    }
    ATTACHED.add(tabId);
    lastError = '';
    chrome.debugger.sendCommand({ tabId }, 'Network.enable', () => {
      if (chrome.runtime.lastError) {
        lastError = 'Network.enable: ' + chrome.runtime.lastError.message;
      }
    });
  });
}

function detachDebugger(tabId) {
  if (!ATTACHED.has(tabId)) return;
  ATTACHED.delete(tabId);
  chrome.debugger.detach({ tabId }, () => {});
}

chrome.debugger.onDetach.addListener((source) => {
  ATTACHED.delete(source.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (MONITORED.test(tab.url)) attachDebugger(tabId);
    else detachDebugger(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    if (MONITORED.test(tab.url)) attachDebugger(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
  WS_URLS.delete(tabId);
  PENDING_WS.delete(tabId);
});

function probePageForModel(tabId) {
  return new Promise((resolve) => {
    const expression = `(() => {
      const specific = [
        /gpt-4o-mini/gi, /gpt-4o/gi, /gpt-4\\.1/gi, /gpt-3\\.5-turbo/gi,
        /o4-mini/gi, /o3-mini/gi, /\\bo1\\b/gi, /\\bo3\\b/gi, /\\bo4\\b/gi,
        /claude\\s*(4|3\\.7|3\\.5)/gi,
        /deepseek-v3/gi, /deepseek-r1/gi, /llama-3/gi, /llama-4/gi,
        /mistral-large/gi, /mistral-small/gi, /gemini-(1|2|3)\\.[0-9]/gi, /grok-(1|2|3|4)/gi
      ];
      const generic = [/gpt-4/gi, /claude/gi, /gemini/gi, /deepseek/gi, /llama/gi, /mistral/gi, /grok/gi, /copilot/gi];
      const scan = (patterns) => {
        const counts = {};
        for (const p of patterns) {
          let m;
          while ((m = p.exec(text)) !== null) {
            const key = m[0].toLowerCase().replace(/\\s+/g, ' ');
            counts[key] = (counts[key] || 0) + 1;
          }
        }
        let best = '';
        let bestN = 0;
        for (const [k, n] of Object.entries(counts)) {
          if (n > bestN || (n === bestN && n > 0 && k.length > best.length)) {
            bestN = n;
            best = k;
          }
        }
        return best;
      };
      const text = (document.body ? document.body.innerText : '').slice(0, 200000);
      return scan(specific) || scan(generic);
    })()`;
    chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      { expression, returnByValue: true },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.result) return resolve('');
        resolve(typeof res.result.value === 'string' ? res.result.value : '');
      }
    );
  });
}

function sendCapture(tabId, url, input, output, model) {
  if (!input || !output) {
    console.log('[audit-debug] sendCapture aborted. input len:', input?.length || 0, 'output len:', output?.length || 0);
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    let domain = '';
    let matched_ai_system = '';
    let tab_title = '';
    if (tab && !chrome.runtime.lastError) {
      domain = new URL(tab.url).hostname;
      matched_ai_system = getDomainLabel(tab.url) || 'Unknown';
      tab_title = tab.title || '';
    }

    const resolveModelAndPost = (resolvedModel) => {
      const payload = {
        domain,
        matched_ai_system,
        tab_title,
        timestamp_client: new Date().toISOString(),
        model_version: resolvedModel || '',
        input_text: input.slice(0, 60000),
        output_text: output.slice(0, 100000),
      };

      chrome.storage.local.get(['auth_token', 'auth_user'], async (result) => {
        const headers = { 'Content-Type': 'application/json' };
        if (result.auth_token) headers['Authorization'] = `Bearer ${result.auth_token}`;
        
        const backendUrl = await getBackendUrl();
        fetch(`${backendUrl}/api/detector/event`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })
          .then(async (res) => {
            if (!res.ok) {
              const text = await res.text().catch(() => '');
              lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
              console.error('Capture HTTP error:', res.status, text);
              return;
            }
            lastError = '';
            lastCaptureAt = Date.now();
            console.log('Shadow detector captured:', {
              site: matched_ai_system,
              model: payload.model_version,
              input_chars: payload.input_text.length,
              output_chars: payload.output_text.length,
            });
          })
          .catch((err) => {
            lastError = String(err);
            console.error('Capture error:', err);
          });
      });
    };

    if (model) {
      resolveModelAndPost(model);
    } else {
      probePageForModel(tabId).then((probed) => {
        if (probed) console.log('[audit] model via DOM probe:', probed);
        resolveModelAndPost(probed);
      });
    }
  });
}

function logWs(dir, data, note) {
  const preview = typeof data === 'string' ? data.slice(0, 300) : String(data);
  console.log('[audit-debug] WS', dir, note || '', preview);
}

function extractWsInput(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  if (parsed.message && typeof parsed.message.text === 'string') return parsed.message.text;
  if (parsed.event === 'send' && Array.isArray(parsed.content)) {
    const parts = parsed.content
      .map((p) => (typeof p === 'string' ? p : p && p.text))
      .filter((t) => typeof t === 'string' && t);
    const joined = parts.join('\n').trim();
    if (joined) return joined;
  }
  if (typeof parsed.text === 'string' && parsed.text) return parsed.text;
  if (parsed.role === 'user' && typeof parsed.content === 'string') return parsed.content;
  if (Array.isArray(parsed.messages)) {
    for (let i = parsed.messages.length - 1; i >= 0; i--) {
      const m = parsed.messages[i];
      if (!m) continue;
      const role = m.role || (m.author && m.author.role);
      if (role === 'user') {
        let t = '';
        if (m.content && Array.isArray(m.content.parts)) {
          t = m.content.parts.filter(p => typeof p === 'string').join('\n');
        } else {
          t = textFromContent(m.content);
        }
        if (t) return t;
      }
    }
  }
  return '';
}

function extractWsOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  if (parsed.event === 'appendText' && typeof parsed.text === 'string') return parsed.text;
  if (parsed.message && typeof parsed.message.text === 'string') {
    if (parsed.message.author && parsed.message.author !== 'assistant') return '';
    return parsed.message.text;
  }
  if (parsed.message && typeof parsed.message.content === 'string') return parsed.message.content;
  if (parsed.type === 3 && parsed.evt) {
    const inner = parsed.evt;
    if (Array.isArray(inner.tokens)) {
      return inner.tokens.filter((t) => typeof t === 'string').join('');
    }
    if (typeof inner.rawResponse === 'string' && inner.rawResponse) {
      try {
        const o = JSON.parse(inner.rawResponse);
        if (Array.isArray(o.tokens)) return o.tokens.filter((t) => typeof t === 'string').join('');
      } catch (e) {}
    }
  }
  return '';
}

function findModel(parsed, seen = new Set(), depth = 0) {
  if (!parsed || typeof parsed !== 'object' || depth > 4) return '';
  if (Array.isArray(parsed)) {
    for (const v of parsed) {
      const m = findModel(v, seen, depth + 1);
      if (m) return m;
    }
    return '';
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string' && v.length < 80) {
      const key = k.toLowerCase();
      if (/model|deployment|engine|llm|generator|family/.test(key) && !seen.has(k + v)) {
        seen.add(k + v);
        return v;
      }
    } else if (v && typeof v === 'object') {
      const m = findModel(v, seen, depth + 1);
      if (m) return m;
    }
  }
  return '';
}

function handleWsFrame(tabId, data, isReceived) {
  if (isReceived) DIAG.recv += 1;
  else DIAG.sent += 1;
  DIAG.lastPreview = (typeof data === 'string' ? data.slice(0, 200) : String(data)) || '';
  if (!data || typeof data !== 'string') return;
  let parsed = null;
  try {
    parsed = JSON.parse(data);
  } catch (e) {
    logWs(isReceived ? 'RECV' : 'SENT', data, '[non-JSON]');
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  logWs(isReceived ? 'RECV' : 'SENT', data);

  if (!isReceived) {
    const text = extractWsInput(parsed);
    const modelHint = findModel(parsed);
    if (modelHint) console.log('[audit] model hint (sent):', modelHint);
    if (!text) return;
    let state = PENDING_WS.get(tabId);
    if (!state) {
      state = new Map();
      PENDING_WS.set(tabId, state);
    }
    if (!state.has(text)) state.set(text, { output: '', timer: null, model: modelHint || '' });
    DIAG.inputs += 1;
    console.log('[audit] WS input stored', JSON.stringify(text.slice(0, 80)), 'pending:', state.size);
    return;
  }

  const out = extractWsOutput(parsed);
  if (!out && parsed.event !== 'done') return;
  const state = PENDING_WS.get(tabId);
  if (!state) return;

  const scheduleFinalize = (input, entry, delay) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      state.delete(input);
      if (input && entry.output) {
        DIAG.captures += 1;
        console.log('[audit] WS capture', JSON.stringify(input.slice(0, 80)), '->', entry.output.length, 'chars', 'model:', entry.model || '?');
        sendCapture(tabId, 'wss://copilot.microsoft.com/c/api/chat', input, entry.output, entry.model || '');
      }
    }, delay);
  };

  for (const [input, entry] of state.entries()) {
    if (!entry.model) {
      const modelHint = findModel(parsed);
      if (modelHint) entry.model = modelHint;
    }
    if (out) {
      let merged;
      if (!entry.output) merged = out;
      else if (out.startsWith(entry.output)) merged = out;
      else merged = entry.output + out;
      if (merged.length > entry.output.length) entry.output = merged;
    }
    scheduleFinalize(input, entry, parsed.event === 'done' || parsed.event === 'partCompleted' ? 500 : 2000);
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  // Diagnostic: log OpenAI-related network events for troubleshooting
  try {
    const maybeUrl = params && (params.request && params.request.url) || params && params.url || '';
    if (maybeUrl && maybeUrl.toString().includes('openai')) {
      console.log('[audit-debug] onEvent', method, 'tabId:', tabId, 'url:', maybeUrl, 'requestId:', params && params.requestId);
    }
  } catch (e) {
    console.error('[audit-debug] logging failure', e);
  }
  if (method === 'Network.requestWillBeSent') {
    const req = params.request;
    const url = req && req.url ? req.url : '';
    const methodName = req && req.method ? req.method.toUpperCase() : '';
    if (methodName === 'POST' && isChatRequest(url)) {
      console.log('[audit-debug] matched chat request:', url);
      const register = (postData) => {
        console.log('[audit-debug] registering postData for:', url, 'length:', postData ? postData.length : 0);
        const host = new URL(url).hostname;
        const extracted = postData ? extractInputAndModel(postData) : null;
        let input = (extracted && extracted.inputText) || '';
        let model = (extracted && extracted.model) || '';
        if ((host === 'gemini.google.com' || host === 'bard.google.com') && !input && postData) {
          input = extractGeminiInput(postData);
        }
        console.log('[audit-debug] extracted input:', input, 'model:', model);
        PENDING_FETCH.set(params.requestId, { tabId, url, input, model });
      };
      if (req.postData) {
        register(req.postData);
      } else {
        chrome.debugger.sendCommand(
          { tabId },
          'Network.getRequestPostData',
          { requestId: params.requestId },
          (res) => {
            if (!chrome.runtime.lastError && res) register(res.postData || '');
          }
        );
      }
    }
    return;
  }

  if (method === 'Network.loadingFinished') {
    const pending = PENDING_FETCH.get(params.requestId);
    if (!pending) return;
    console.log('[audit-debug] loadingFinished for:', pending.url);
    PENDING_FETCH.delete(params.requestId);
    chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: params.requestId }, (res) => {
      if (chrome.runtime.lastError || !res || (!res.body && res.body !== '')) {
         console.log('[audit-debug] getResponseBody failed for:', pending.url, chrome.runtime.lastError, res);
         return;
      }
      let body = res.body || '';
      if (res.base64Encoded && body) {
        try {
          const bin = atob(body);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
          }
          body = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          body = atob(res.body);
        }
      }
      let output = '';
      let model = pending.model;
      let input = pending.input || '';
      const host = new URL(pending.url).hostname;
      console.log('[audit-debug] getResponseBody success for:', pending.url, 'body starts with:', body.substring(0, 200).replace(/\n/g, '\\n'));
      if (host === 'claude.ai') {
        const parsed = parseClaudeSSE(body);
        output = parsed.outputText;
        if (parsed.model) model = parsed.model;
      } else if (host.includes('copilot')) {
        const parsed = parseCopilotSSE(body);
        output = parsed.outputText;
        if (parsed.model) model = parsed.model;
      } else if (host.includes('openai') || host.includes('chatgpt') || host === 'chat.openai.com') {
        const parsed = parseChatGPTSse(body);
        output = parsed.outputText;
        if (parsed.model) model = parsed.model;
      }
      sendCapture(tabId, pending.url, input, output, model);
    });
    return;
  }

  if (method === 'Network.webSocketCreated') {
    let set = WS_URLS.get(tabId);
    if (!set) {
      set = new Set();
      WS_URLS.set(tabId, set);
    }
    set.add(params.url || '');
    DIAG.wsCreated += 1;
    console.log('[audit-debug] WS created', String(params.url).slice(0, 120));
    return;
  }

  if (method === 'Network.webSocketFrameSent') {
    handleWsFrame(tabId, params.response && params.response.payloadData, false);
    return;
  }

  if (method === 'Network.webSocketFrameReceived') {
    handleWsFrame(tabId, params.response && params.response.payloadData, true);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING_CAPTURE') {
    sendResponse({
      active: true,
      attached: ATTACHED.size > 0,
      lastCaptureAt,
      lastError,
      diag: DIAG,
    });
    return false;
  }

  return false;
});
