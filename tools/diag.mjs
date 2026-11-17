#!/usr/bin/env node
// 用 CDP 打开页面读取启动诊断（__ready/__frames/__fatal/__errors/stub），不做截图。
// 用法: node tools/diag.mjs <url> [轮询ms，默认15000]
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [, , url, waitArg = '15000'] = process.argv;
const exprArg = process.argv.find((a) => a.startsWith('--expr='));
if (!url) {
  console.error('用法: node tools/diag.mjs <url> [轮询ms] [--expr=<js表达式>]');
  process.exit(2);
}

const port = 9600 + Math.floor(Math.random() * 200);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--window-size=1400,1000',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/diag-profile-${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shutdown = (code) => {
  try { ws?.close(); } catch {}
  chrome.kill();
  process.exit(code);
};

let ws;
async function waitForPort() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

try {
  await waitForPort();
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === 'page');
  const { WebSocket } = await import('node:websocket' in {} ? 'node:websocket' : 'ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(2000);

  const expr = exprArg
    ? `JSON.stringify(eval(${JSON.stringify(exprArg.slice(7))}))`
    : `(function(){
    var g = window.__G || {};
    return JSON.stringify({
      ready: window.__ready, frames: window.__frames,
      fatal: (window.__fatal||'').slice(0,2000),
      errors: (window.__errors||[]).slice(0,8),
      stubs: g ? Object.keys(g).filter(function(k){var v=g[k];return v&&typeof v==='object'&&v.stub;}).join(',') : null,
      state: g.game ? g.game.state : null,
    });
  })()`;
  const deadline = Date.now() + Number(waitArg);
  let last = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    last = r.result?.result?.value ?? JSON.stringify(r);
    const parsed = JSON.parse(last);
    if (parsed.ready || (parsed.fatal && parsed.fatal.length)) break;
  }
  console.log(last);
  shutdown(0);
} catch (e) {
  console.error('diag 失败:', e.message);
  shutdown(1);
}
