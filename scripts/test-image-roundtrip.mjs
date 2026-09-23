import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';

// Real renderer + real native file IPC, with test-only file picker responses.
// A fresh profile and OS-assigned ports ensure this cannot touch the user's app.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'excalidraw-image-roundtrip-'));
const child = spawn(electron, ['.', '--remote-debugging-port=0', '--inspect=0'], {
  cwd: process.cwd(), env: { ...process.env, MY_EXCALIDRAW_DATA_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
let log = '';
let mainURL;
let rendererURL;
const startup = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Electron startup timeout: ${log}`)), 30000);
  const collect = data => {
    log = (log + data.toString()).slice(-16000);
    mainURL ??= log.match(/Debugger listening on (ws:\S+)/)?.[1];
    rendererURL ??= log.match(/DevTools listening on (ws:\S+)/)?.[1];
    if (mainURL && rendererURL) { clearTimeout(timer); resolve(); }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Electron exited (${code}): ${log}`)); });
});
function evaluate(url, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Renderer evaluation timed out')); }, 60000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })));
    socket.addEventListener('error', error => { clearTimeout(timeout); reject(error); });
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data);
      if (result.id !== 1) return;
      clearTimeout(timeout); socket.close();
      if (result.error || result.result?.exceptionDetails) reject(new Error(JSON.stringify(result.error ?? result.result.exceptionDetails)));
      else resolve(result.result.result.value);
    });
  });
}
try {
  await startup;
  await evaluate(mainURL, `(async()=>{
    globalThis.testElectron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    if(testElectron.app.getPath('userData')!==${JSON.stringify(root)})throw Error('Unsafe test profile');
    await testElectron.app.whenReady();
    testElectron.dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:${JSON.stringify(root)}+'/'+options.defaultPath});
    testElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(root)}+'/roundtrip.png']});
    return true;
  })()`);
  const endpoint = `http://${new URL(rendererURL).host}/json/list`;
  let page;
  // Wait for target creation, not network idleness or an arbitrary app sleep.
  for (let n = 0; n < 100 && !page; n++) {
    page = (await fetch(endpoint).then(response => response.json())).find(target => target.type === 'page');
    if (!page) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(page, 'Electron renderer target was not created');
  await evaluate(page.webSocketDebuggerUrl, `(async()=>{if(document.readyState!=='complete')await new Promise(r=>window.addEventListener('load',r,{once:true}));return !!window.desktop;})()`);
  const chunk = (await fs.readdir('dist/assets')).find(name => /^ImageService-.*\.js$/.test(name));
  assert.ok(chunk, 'Run npm run build before the image integration test');
  await evaluate(page.webSocketDebuggerUrl, `globalThis.imageServiceURL=new URL(${JSON.stringify(`./assets/${chunk}`)},location.href).href`);
  const result = await evaluate(page.webSocketDebuggerUrl, await fs.readFile('tests/image-roundtrip.browser.js', 'utf8'));
  const png = await fs.readFile(path.join(root, 'roundtrip.png'));
  let dpi;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'pHYs') dpi = png.readUInt32BE(offset + 8) * 0.0254;
    offset += length + 12;
  }
  assert.ok(Math.abs(dpi - 600) < 0.01, 'Native PNG DPI metadata is missing');
  console.log(JSON.stringify({ ...result, dpi: Math.round(dpi) }));
} finally {
  // Terminate only the owned test process; real application quit still flushes drafts.
  if (child.exitCode === null) child.kill('SIGTERM');
  await exited.catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
}
