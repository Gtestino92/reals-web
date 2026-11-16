import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { withIdentityChrome } from './identity-chrome.mjs';
const base=process.argv.find(a=>a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5175';
const visible=process.argv.includes('--visible'),scale=Number(process.argv.find(a=>a.startsWith('--scale='))?.slice(8) ?? 1);
const specs=[['/favicon-16.png',16],['/favicon-32.png',32],['/apple-touch-icon.png',180],['/icons/icon-192.png',192],['/icons/icon-512.png',512],['/icons/icon-maskable-512.png',512]];
for(const [path,size] of specs){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/^image\/png/);const png=Buffer.from(await r.arrayBuffer());assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
const icoResponse=await fetch(base+'/favicon.ico');assert.equal(icoResponse.status,200);assert.match(icoResponse.headers.get('content-type'),/^image\/(?:x-icon|vnd.microsoft.icon)/);
const ico=Buffer.from(await icoResponse.arrayBuffer());assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),2);
for(let i=0;i<2;i++){const at=6+i*16;assert.equal(ico[at],[16,32][i]);const offset=ico.readUInt32LE(at+12),length=ico.readUInt32LE(at+8);assert.deepEqual(ico.subarray(offset,offset+length),await readFile(`public/favicon-${[16,32][i]}.png`));}
const mr=await fetch(base+'/manifest.webmanifest');assert.equal(mr.status,200);assert.match(mr.headers.get('content-type'),/^application\/manifest\+json/);const manifest=await mr.json();
assert.equal(manifest.name,'Reals');assert.equal(manifest.short_name,'Reals');assert.equal(manifest.display,'standalone');for(const key of ['id','scope','start_url'])assert.equal(manifest[key],'/');
assert.equal(manifest.theme_color,'#f7f2e8');assert.equal(manifest.background_color,'#f7f2e8');
assert.deepEqual(manifest.icons.map(i=>[i.src,i.sizes,i.type,i.purpose]),[['/icons/icon-192.png','192x192','image/png','any'],['/icons/icon-512.png','512x512','image/png','any'],['/icons/icon-maskable-512.png','512x512','image/png','maskable']]);
await mkdir('artifacts/identity',{recursive:true});
await withIdentityChrome(async({call,evaluate})=>{
  await call('Page.enable');await call('Page.navigate',{url:base});
  for(let i=0;i<100;i++){try{if(await evaluate("document.title==='Reals' && !!document.querySelector('link[rel=manifest]')"))break;}catch(error){if(!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message))throw error;}await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate('document.title'),'Reals');
  const links=await evaluate("[...document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon],link[rel=manifest]')].map(n=>n.getAttribute('href'))");
  assert.deepEqual(links,['/favicon.ico','/favicon-16.png','/favicon-32.png','/apple-touch-icon.png','/manifest.webmanifest']);
  for(const [scheme,color] of [['light','#f7f2e8'],['dark','#08111f']]){
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    assert.equal(await evaluate("[...document.querySelectorAll('meta[name=theme-color]')].find(n=>matchMedia(n.media).matches)?.content"),color);
  }
  const app=await call('Page.getAppManifest');assert.equal(app.url,base+'/manifest.webmanifest');assert.deepEqual(app.errors,[]);assert.equal(JSON.parse(app.data).id,'/');
  const pixelReport=await evaluate(`(async()=>{const specs=${JSON.stringify(specs)},out=[];for(const [path,size] of specs){const image=new Image();image.src=path;await image.decode();const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d');x.drawImage(image,0,0);const p=x.getImageData(0,0,size,size).data;let min=255,max=0,radius=0,artPixels=0;for(let y=0;y<size;y++)for(let z=0;z<size;z++){const i=(y*size+z)*4;min=Math.min(min,p[i+3]);max=Math.max(max,p[i+3]);if(path.includes('maskable')&&p[i]<210&&p[i+1]<190&&p[i+2]<170){radius=Math.max(radius,Math.hypot(z+.5-size/2,y+.5-size/2));artPixels++;}}out.push({path,size,alpha:[min,max],radius,artPixels});}return out;})()`);
  for(const item of pixelReport){if(!item.path.includes('192'))assert.deepEqual(item.alpha,[255,255]);if(item.path.includes('maskable')){assert.ok(item.artPixels>1000);assert.ok(item.radius<512*.4,JSON.stringify(item));}}
  const installability=await call('Page.getInstallabilityErrors');
  console.log(JSON.stringify({base,scale,manifest:'PASS',pixels:pixelReport,installability:installability.installabilityErrors}));
  // Separate review sheet: actual 16/32 px samples and common launcher masks.
  const board=await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=800;c.height=520;const x=c.getContext('2d');for(let row=0;row<2;row++){x.fillStyle=row?'#08111f':'#f7f2e8';x.fillRect(0,row*110,800,110);x.fillStyle=row?'white':'black';x.font='16px sans-serif';x.fillText(row?'Dark tab background':'Light tab background',12,row*110+22);for(const [i,size] of [16,32].entries()){const im=new Image();im.src='/favicon-'+size+'.png';await im.decode();x.drawImage(im,230+i*100,row*110+32,size,size);}}const mask=new Image();mask.src='/icons/icon-maskable-512.png';await mask.decode();for(let i=0;i<3;i++){x.save();x.beginPath();if(i===0)x.arc(130,365,105,0,Math.PI*2);else if(i===1)x.roundRect(275,260,210,210,45);else x.rect(535,260,210,210);x.clip();x.drawImage(mask,25+i*255,260,210,210);x.restore();}return c.toDataURL().split(',')[1];})()`);
  await writeFile(`artifacts/identity/review-${scale}x.png`,Buffer.from(board,'base64'));
  if(visible){console.log('Native Chrome ready for tab inspection (60 seconds)');await new Promise(r=>setTimeout(r,60000));}
},{visible,scale});
