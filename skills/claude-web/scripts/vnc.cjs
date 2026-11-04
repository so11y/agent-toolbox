#!/usr/bin/env node
'use strict';

// JSON in, JSON out. Node 22+; no packages. Browser stays open between calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Browser connection closed; inspect the page before retrying an action.'));
      }
      this.pending.clear();
    });
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Browser connection timed out.'));
      }, 10000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Cannot connect to browser. Run connect with the current VNC URL.'));
      }, { once: true });
    });
    return new CDP(ws);
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timed out; do not repeat a write without inspecting the page.'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function tabs(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Cannot list browser tabs: HTTP ' + response.status);
  return response.json();
}

async function findBrowser(explicit) {
  if (explicit) { await fs.access(explicit); return explicit; }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Chromium browser not found. Supply browserPath.');
}

async function startBrowser(sessionDir, browserPath) {
  const profile = path.join(sessionDir, 'browser-profile');
  await fs.mkdir(profile, { recursive: true });
  const portFile = path.join(profile, 'DevToolsActivePort');
  // The profile belongs to this session. Never reuse a stale debug port.
  await fs.unlink(portFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const child = spawn(await findBrowser(browserPath), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const content = await fs.readFile(portFile, 'utf8');
      return { port: Number(content.split('\n')[0]), pid: child.pid };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await sleep(200);
  }
  throw new Error('Browser did not expose its debug port. Check the session profile before reconnecting.');
}

async function connection(input) {
  const stateFile = path.join(input.sessionDir, 'session.json');
  if (input.action === 'connect' && input.debugPort) {
    const target = (await tabs(input.debugPort)).find(t => t.type === 'page' && /\/vnc[^/]*\.html(?:[?#]|$)/.test(t.url));
    if (!target) throw new Error('No noVNC tab exists at the supplied debugPort.');
    const state = { port: input.debugPort, targetId: target.id };
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    return { client: await CDP.open(target.webSocketDebuggerUrl), state };
  }
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state) {
    const target = (await tabs(state.port)).find(t => t.id === state.targetId);
    if (!target) throw new Error('Saved VNC tab is gone. Use a new sessionDir and connect with its VNC URL.');
    return { client: await CDP.open(target.webSocketDebuggerUrl), state };
  }
  if (input.action !== 'connect' || !input.url) {
    throw new Error('First call must be connect with url, or connect with an existing noVNC debugPort.');
  }
  const address = new URL(input.url);
  if (!['http:', 'https:'].includes(address.protocol)) throw new Error('VNC URL must use HTTP or HTTPS.');
  const browser = await startBrowser(input.sessionDir, input.browserPath);
  const target = (await tabs(browser.port)).find(t => t.type === 'page');
  if (!target) throw new Error('Browser has no page target.');
  const client = await CDP.open(target.webSocketDebuggerUrl);
  try {
    await client.call('Page.enable');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await client.call('Page.navigate', { url: input.url });
    state = { port: browser.port, targetId: target.id, pid: browser.pid };
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    for (let attempt = 0; attempt < 50; attempt++) {
      const ready = await client.evaluate('document.documentElement.classList.contains("noVNC_connected")');
      if (ready) break;
      await sleep(200);
    }
    return { client, state };
  } catch (error) {
    client.close();
    throw error;
  }
}

// This script runs in the local noVNC tab, never in Claude's remote DOM.
async function initialize(client) {
  const connected = await client.evaluate('document.documentElement.classList.contains("noVNC_connected")');
  if (!connected) {
    return client.evaluate('({connected:false,title:document.title,message:document.body.innerText})');
  }
  return client.evaluate('import(new URL("./app/ui.js",location.href).href).then(({default:ui})=>{' +
    'if(!window.__claudeWeb || window.__claudeWeb.rfb!==ui.rfb){' +
    'window.__claudeWeb={rfb:ui.rfb,clipboard:{revision:0,text:null}};' +
    'ui.rfb.addEventListener("clipboard",e=>{' +
    'const c=window.__claudeWeb.clipboard;c.revision++;c.text=e.detail.text;});}' +
    'const c=document.querySelector("canvas");return {' +
    'connected:true,viewOnly:ui.rfb.viewOnly,title:document.title,' +
    'canvas:{width:c.width,height:c.height},clipboardRevision:window.__claudeWeb.clipboard.revision};})');
}

const keysyms = {
  CTRL: 0xffe3, SHIFT: 0xffe1, ALT: 0xffe9, SUPER: 0xffeb,
  ENTER: 0xff0d, ESCAPE: 0xff1b, TAB: 0xff09, BACKSPACE: 0xff08, DELETE: 0xffff,
  UP: 0xff52, DOWN: 0xff54, LEFT: 0xff51, RIGHT: 0xff53,
  HOME: 0xff50, END: 0xff57, PAGEUP: 0xff55, PAGEDOWN: 0xff56,
};

async function key(client, combination) {
  const values = combination.split('+').map(part => {
    if (keysyms[part.toUpperCase()]) return keysyms[part.toUpperCase()];
    if ([...part].length !== 1) throw new Error('Unknown key: ' + part);
    const point = part.toLowerCase().codePointAt(0);
    return point <= 255 ? point : (0x01000000 | point);
  });
  await client.evaluate('(()=>{const r=window.__claudeWeb.rfb;const keys=' + JSON.stringify(values) +
    ';try{for(const k of keys)r.sendKey(k,null,true);}finally{for(const k of keys.reverse())r.sendKey(k,null,false);}})()');
}

async function main(input) {
  if (!input.sessionDir || !path.isAbsolute(input.sessionDir)) throw new Error('sessionDir must be an absolute workspace work/ path.');
  await fs.mkdir(input.sessionDir, { recursive: true });
  const { client, state } = await connection(input);
  try {
    const status = await initialize(client);
    if (input.action === 'connect' || input.action === 'status') return { ...status, debugPort: state.port };
    if (input.action === 'screenshot') {
      if (!input.output || !path.isAbsolute(input.output)) throw new Error('Screenshot output must be an absolute path.');
      const shot = await client.call('Page.captureScreenshot', { format: 'png' });
      await fs.mkdir(path.dirname(input.output), { recursive: true });
      await fs.writeFile(input.output, Buffer.from(shot.data, 'base64'));
      return { output: input.output, ...status };
    }
    if (!status.connected) throw new Error('VNC is disconnected. Inspect a screenshot.');
    if (input.action === 'clipboard') return await client.evaluate('window.__claudeWeb.clipboard');
    if (status.viewOnly) throw new Error('VNC is in view-only mode.');
    switch (input.action) {
      case 'click': {
        const position = { x: input.x, y: input.y };
        await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
        await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 });
        await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 });
        break;
      }
      case 'scroll':
        await client.call('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.dx || 0, deltaY: input.dy,
        });
        break;
      case 'key':
        await key(client, input.keys);
        break;
      case 'type':
        if (typeof input.text !== 'string' || /[\r\n]/.test(input.text)) {
          throw new Error('type accepts a single line. Use paste for multiline messages.');
        }
        await client.evaluate('(()=>{const r=window.__claudeWeb.rfb;for(const ch of ' + JSON.stringify(input.text) +
          '){const p=ch.codePointAt(0),k=p<=255?p:(0x01000000|p);r.sendKey(k,null,true);r.sendKey(k,null,false);}})()');
        break;
      case 'paste':
        if (typeof input.text !== 'string') throw new Error('paste requires text.');
        await client.evaluate('(()=>{const r=window.__claudeWeb.rfb;' +
          'if(!r._clipboardServerCapabilitiesFormats[1] || !r._clipboardServerCapabilitiesActions[134217728])' +
          'throw new Error("Unicode clipboard is unsupported; use type for one line.");' +
          'r.clipboardPasteFrom(' + JSON.stringify(input.text) + ');})()');
        await sleep(200);
        await key(client, 'CTRL+v');
        break;
      default:
        throw new Error('Unknown action: ' + input.action);
    }
    return { action: input.action, dispatched: true };
  } finally {
    client.close();
  }
}

if (require.main === module) {
  (async () => {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const result = await main(JSON.parse(raw));
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  })().catch(error => {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { main, CDP };
