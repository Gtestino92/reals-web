import { withIdentityChrome } from './identity-chrome.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const results = [];
const phase = process.argv.includes('--before') ? 'before' : 'after';
await mkdir('artifacts/ux-audit', { recursive: true });
await withIdentityChrome(async ({ call, evaluate }) => {
  const wait = async expression => { for (let i=0;i<150;i++) { if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50)); } throw Error(`Timeout: ${expression} `+await evaluate("JSON.stringify({active:document.activeElement?.outerHTML,body:document.body.innerText})")); };
  const click = async label => {
    const expr=`[...document.querySelectorAll('button')].find(n=>n.getClientRects().length&&(n.textContent===${JSON.stringify(label)}||n.getAttribute('aria-label')===${JSON.stringify(label)})&&!n.matches(':disabled'))`;
    await wait(`!!(${expr})`);await evaluate(`(${expr}).scrollIntoView({block:'center'})`);
    const point=await evaluate(`(()=>{const n=${expr},r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!n.contains(document.elementFromPoint(x,y)))throw Error('Action intercepted');return{x,y}})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const measure = async label => { const value=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(label)}),r=b.getBoundingClientRect();return {label:${JSON.stringify(label)},y:r.y,bottom:r.bottom,height:r.height,scrollY,scrollToReach:Math.max(0,r.bottom-innerHeight),viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`);results.push({phase,width:await evaluate('innerWidth'),...value});return value; };
  for(const width of [390,1280]) {
    await call('Page.bringToFront');
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});
    await call('Page.navigate',{url:'http://127.0.0.1:5174/tools/ux-audit-fixture.html'});
    await wait("!!document.getElementById('login-email')&&!document.getElementById('login-email').disabled");
    for(const [selector,value] of [['#login-email','synthetic@example.invalid'],['#login-password','synthetic-only']]) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await call('Input.insertText',{text:value}); }
    await click('Ingresar');await click('Confirmar lectura');
    await wait("!!document.querySelector('.profile-form')&&!document.querySelector('.profile-submit').disabled");
    await evaluate('scrollTo(0,0)');await measure('Crear perfil');
    await evaluate("document.querySelector('.profile-submit').scrollIntoView({block:'center'})");
    await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`artifacts/ux-audit/${phase}-create-${width}.png`,Buffer.from(r.data,'base64')));
    // Native keyboard Enter triggers real form submission and client validation.
    await evaluate("document.querySelector('.profile-submit').focus()");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    if(phase==='after')await wait("document.activeElement?.name==='displayName'&&!!document.querySelector('[role=alert]')");
    for(const [label,value] of [['Nombre visible','Prueba'],['Fecha de nacimiento','1995-01-01'],['Ciudad','Córdoba']]) {
      await evaluate(`(()=>{const n=[...document.querySelectorAll('.profile-form label')].find(n=>n.firstChild.textContent===${JSON.stringify(label)}).querySelector('input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    if(phase==='after') {
      await evaluate("(()=>{for(const [label,value] of [['Género','OTHER'],['Intención','FRIENDSHIP']]){const n=[...document.querySelectorAll('.profile-form label')].find(n=>n.firstChild.textContent===label).querySelector('select');n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('.gender-preferences input').click();})()");
    }
    await evaluate('auditFixture.hold(true)');await click('Crear perfil');
    await wait("auditFixture.writes.some(n=>n.path==='/me/profile')");
    if(await evaluate("auditFixture.writes.filter(n=>n.path==='/me/profile').length")!==1)throw Error('Duplicate create');
    await evaluate('auditFixture.release()');await wait("!![...document.querySelectorAll('h2')].find(n=>n.textContent==='Completá tu perfil')&&!document.querySelector('.onboarding').getAttribute('aria-busy').includes('true')");
    await evaluate('scrollTo(0,0)');await measure('Activar perfil');
    if(phase==='after') {
      for(const zoom of [1,2]) {await evaluate(`document.documentElement.style.fontSize='${zoom*100}%'`);await evaluate('scrollTo(0,0)');const m=await evaluate('scrollTo(0,0)');await measure('Activar perfil');if(m.overflow)throw Error('Horizontal overflow');await evaluate("[...document.querySelectorAll('button')].find(n=>n.textContent==='Activar perfil').scrollIntoView({block:'center'})");const reachable=await measure('Activar perfil');if(reachable.y<0||reachable.bottom>844)throw Error('Unreachable activation action');}
      await evaluate("document.documentElement.style.fontSize='100%'");
      const { root } = await call('DOM.getDocument');
      const { nodeId } = await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.photo-slot input[type=file]'});
      await call('DOM.setFileInputFiles',{nodeId,files:[resolve('src/assets/reals-seal.png')]});
      await click('Usar foto');await wait("!document.querySelector('.crop-dialog')&&auditFixture.writes.some(n=>n.path==='/me/profile/photos')");
      if(await evaluate("auditFixture.writes.filter(n=>n.path==='/me/profile/photos').length")!==1)throw Error('Duplicate photo upload');
    }
    await click('Activar perfil');await click('Cuenta');await click('Cerrar sesión');await click('Cancelar');await click('Cerrar sesión');await evaluate("document.querySelector('dialog button:last-child').click()");await wait("!!document.getElementById('login-email')");
  }
});
await writeFile(`artifacts/ux-audit/${phase}-measurements.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
