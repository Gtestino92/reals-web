import { captureDiagnostics } from './browser-diagnostics.mjs';
// Development tooling only: native Chrome decodes/resamples the existing artwork.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function withIdentityChrome(run, { visible = false, scale = 1, appUrl } = {}) {
  const directory = await mkdtemp(join(tmpdir(),'reals-identity-'));
  const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
    ...(!visible ? ['--headless=new'] : []),'--no-first-run','--no-default-browser-check',
    `--force-device-scale-factor=${scale}`,'--remote-debugging-port=0',`--user-data-dir=${directory}`,appUrl ? '--app=' + appUrl : 'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  let socket;
  try {
    let target;
    for(let i=0;i<100;i++) {
      try { const port=(await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0];
        target=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');
        if(target)break;
      } catch { /* Chrome is still starting. */ }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!target)throw Error('Chrome did not expose a test page');
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    let id=0;const pending=new Map();
    socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);return result.result.value;};
    await captureDiagnostics(socket, call, 'identity/ux');
    await run({call,evaluate});
  } finally { socket?.close();chrome.kill(); }
}
