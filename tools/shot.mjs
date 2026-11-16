#!/usr/bin/env node
// 用 Chrome DevTools Protocol 离屏渲染并截图：等 window.__ready 且帧数达标后再抓图，供没有前台浏览器会话时做视觉验证
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [, , url, outPath = '/tmp/shot.png', waitArg = '60000', framesArg = '90'] = process.argv;
if (!url) {
  console.error('用法: node tools/shot.mjs <url> [输出路径] [超时ms] [最少帧数]');
  process.exit(2);
}

const port = 9400 + Math.floor(Math.random() * 200);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--window-size=1400,1000',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/shot-profile-${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

function shutdown(code) {
  try { ws?.close(); } catch {}
  chrome.kill();
  process.exit(code);
}

let ws;
try {
  await waitForPort();
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });

  const deadline = Date.now() + Number(waitArg);
  let frames = 0,
    ready = !1,
    fatal = '';
  while (Date.now() < deadline) {
    const probe = await send('Runtime.evaluate', {
      expression:
        '(window.__ready === true) + "|" + (window.__frames | 0) + "|" + (window.__fatal ? String(window.__fatal) : "") + "|" + ((window.__errors || []).join(";"))',
      returnByValue: !0,
    });
    const [readyFlag, frameCount, fatalFlag, errorText] = String(
      probe.result?.result?.value || '',
    ).split('|');
    ready = readyFlag === 'true';
    frames = Number(frameCount) || 0;
    fatal = fatalFlag;
    if (fatal) break;
    if (errorText) console.error('页面错误:', errorText);
    if (ready && frames >= Number(framesArg)) break;
    await sleep(400);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) {
    console.error(`截图失败（ready=${ready} frames=${frames}）`);
    shutdown(1);
  }
  mkdirSync(dirname(outPath), { recursive: !0 });
  writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
  console.error(`已出图 ${outPath}（ready=${ready} frames=${frames}${fatal ? ' fatal=' + fatal : ''}）`);
  shutdown(0);
} catch (error) {
  console.error('出图失败:', (error && error.message) || error);
  shutdown(1);
}
