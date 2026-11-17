// No runtime/npm dependencies. Run from the repository root with native Chrome.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { withIdentityChrome } from './identity-chrome.mjs';
const sources = {
  seal:'src/assets/reals-seal.png',
  launcher:'../reals-app/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp',
};
const seal=await readFile(sources.seal),notification=await readFile('../reals-app/app/src/main/res/drawable-nodpi/ic_notification_large.png');
if(!seal.equals(notification))throw Error('Review branding: Web seal and Android notification source diverged');
const inputs=Object.fromEntries(await Promise.all(Object.entries(sources).map(async([key,path])=>[key,'data:image/'+(path.endsWith('webp')?'webp':'png')+';base64,'+(await readFile(path)).toString('base64')])));
function chunk(type,data) {
  const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,body,checksum]);
}
// Opaque app icons use a deterministic 256-color median-cut palette. Small tab
// icons stay lossless; the launcher's transparent corners retain their alpha.
function png(width,rgba,indexed) {
  let pixels=rgba,channels=4,palette;
  if(indexed){
    const bins=new Map();
    for(let i=0;i<rgba.length;i+=4){const key=(rgba[i]>>3)*1024+(rgba[i+1]>>3)*32+(rgba[i+2]>>3);const bin=bins.get(key)??{key,count:0,r:0,g:0,b:0};bin.count++;bin.r+=rgba[i];bin.g+=rgba[i+1];bin.b+=rgba[i+2];bins.set(key,bin);}
    const colors=[...bins.values()].map(c=>({...c,r:c.r/c.count,g:c.g/c.count,b:c.b/c.count}));let boxes=[colors];
    while(boxes.length<256){
      const score=box=>box.length<2?0:Math.max(...['r','g','b'].map(k=>Math.max(...box.map(c=>c[k]))-Math.min(...box.map(c=>c[k]))));
      const scores=boxes.map(score),at=scores.indexOf(Math.max(...scores));if(!scores[at])break;
      const box=boxes.splice(at,1)[0],axis=['r','g','b'].sort((a,b)=>(Math.max(...box.map(c=>c[b]))-Math.min(...box.map(c=>c[b])))-(Math.max(...box.map(c=>c[a]))-Math.min(...box.map(c=>c[a]))))[0];
      box.sort((a,b)=>a[axis]-b[axis]||a.key-b.key);const half=box.reduce((n,c)=>n+c.count,0)/2;let total=0,split=1;
      for(;split<box.length;split++){total+=box[split-1].count;if(total>=half)break;}
      split=Math.min(split,box.length-1);boxes.push(box.slice(0,split),box.slice(split));
    }
    const lookup=new Map();palette=Buffer.alloc(boxes.length*3);
    boxes.forEach((box,index)=>{const count=box.reduce((n,c)=>n+c.count,0);['r','g','b'].forEach((k,j)=>palette[index*3+j]=Math.round(box.reduce((n,c)=>n+c[k]*c.count,0)/count));box.forEach(c=>lookup.set(c.key,index));});
    pixels=Buffer.alloc(width*width);for(let i=0;i<pixels.length;i++)pixels[i]=lookup.get((rgba[i*4]>>3)*1024+(rgba[i*4+1]>>3)*32+(rgba[i*4+2]>>3));channels=1;
  }
  const rows=Buffer.alloc(width*(width*channels+1));for(let y=0;y<width;y++)pixels.copy(rows,y*(width*channels+1)+1,y*width*channels,(y+1)*width*channels);
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(width,4);header[8]=8;header[9]=palette?3:6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(palette?[chunk('PLTE',palette)]:[]),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
await mkdir('public/icons',{recursive:true});
await withIdentityChrome(async({evaluate})=>{
  const images=await evaluate(`(async()=>{
    const inputs=${JSON.stringify(inputs)},images={};for(const key of Object.keys(inputs)){const image=new Image();image.src=inputs[key];await image.decode();images[key]=image;}
    const specs=[['favicon-16.png',16,'favicon'],['favicon-32.png',32,'favicon'],['apple-touch-icon.png',180,'seal'],['icon-192.png',192,'launcher'],['icon-512.png',512,'seal'],['icon-maskable-512.png',512,'maskable']].filter(([name]) => !${process.argv.includes('--favicons-only')} || name.startsWith('favicon'));
    return specs.map(([name,size,kind])=>{const c=document.createElement('canvas');c.width=size;c.height=size;const x=c.getContext('2d');x.imageSmoothingQuality='high';
      if(kind==='favicon') {
        // Preserve the Android seal's R, double ring and gold details. Remove
        // only the square surround; ivory inside keeps contrast on dark tabs.
        const seal=document.createElement('canvas');seal.width=seal.height=424;
        const ink=seal.getContext('2d');ink.beginPath();ink.arc(212,212,211,0,Math.PI*2);ink.clip();
        ink.drawImage(images.seal,42,48,424,424,0,0,424,424);
        x.drawImage(seal,0,0,size,size);
      }
      else if(kind==='maskable'){
        // Edge-extend only the source background, then inset its original image.
        const inset=32,side=448,im=images.seal;
        x.drawImage(im,0,0,512,512,0,0,512,512);
        x.drawImage(im,0,0,1,512,0,inset,inset,side);x.drawImage(im,511,0,1,512,480,inset,inset,side);
        x.drawImage(im,0,0,512,1,inset,0,side,inset);x.drawImage(im,0,511,512,1,inset,480,side,inset);
        for(const [sx,sy,dx,dy] of [[0,0,0,0],[511,0,480,0],[0,511,0,480],[511,511,480,480]])x.drawImage(im,sx,sy,1,1,dx,dy,inset,inset);
        x.drawImage(im,inset,inset,side,side);
      }else x.drawImage(images[kind],0,0,size,size);
      const data=x.getImageData(0,0,size,size).data;
      // Drop near-invisible resampling fringes around the circular tab seal.
      if(kind==='favicon')for(let i=3;i<data.length;i+=4)if(data[i]<16)data[i]=0;
      let binary='';for(const byte of data)binary+=String.fromCharCode(byte);return{name,size,rgba:btoa(binary)};
    });
  })()`);
  const files=new Map();
  for(const item of images){const bytes=png(item.size,Buffer.from(item.rgba,'base64'),['apple-touch-icon.png','icon-512.png','icon-maskable-512.png'].includes(item.name));files.set(item.name,bytes);await writeFile('public/'+(item.name.startsWith('favicon')||item.name.startsWith('apple')?'':'icons/')+item.name,bytes);console.log(item.name,bytes.length,'bytes');}
  const frames=[files.get('favicon-16.png'),files.get('favicon-32.png')],header=Buffer.alloc(38);header.writeUInt16LE(1,2);header.writeUInt16LE(2,4);let offset=header.length;
  frames.forEach((frame,i)=>{const at=6+i*16;header[at]=header[at+1]=[16,32][i];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(frame.length,at+8);header.writeUInt32LE(offset,at+12);offset+=frame.length;});
  await writeFile('public/favicon.ico',Buffer.concat([header,...frames]));
});
for(const [key,path] of Object.entries(sources))console.log(key,createHash('sha256').update(await readFile(path)).digest('hex'));
