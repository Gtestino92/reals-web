import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { inspectAudio, prepareRecording } from './audio';
import { admittedAudioFixture } from './audio.test-support';

const fixture = () => new Uint8Array(readFileSync('src/chat/fixtures/chrome-aac-fragmented.mp4')).buffer;
const maxSize=2097152;
// Locate boxes structurally, never by searching encoded media bytes.
function find(bytes: ArrayBuffer, path: string[]): { offset: number; start: number; end: number } {
  const data=new Uint8Array(bytes), view=new DataView(bytes); let start=0,end=data.length;
  for (const type of path) {
    let found=false;
    for (let pos=start;pos+8<=end;) {
      const size=view.getUint32(pos); if (size<8) throw Error('Bad test box');
      if (String.fromCharCode(...data.slice(pos+4,pos+8))===type) { start=pos+8;end=pos+size;found=true;break; } pos+=size;
    }
    if (!found) throw Error('Missing test box '+type);
  }
  return {offset:start-8,start,end};
}
const change=(path: string[], offset: number, value: number) => { const bytes=fixture(); new DataView(bytes).setUint32(find(bytes,path).start+offset,value); return bytes; };
it('finalizes actual native Chrome AAC without changing encoded samples or codec configuration',()=>{
  const original=fixture(), result=prepareRecording(original,60000,maxSize);
  expect(()=>inspectAudio(original,60000,maxSize)).toThrow();
  expect(result.duration).toBeGreaterThan(0); expect(inspectAudio(result.bytes,60000,maxSize)).toBe(result.duration);
  for (const path of [['mdat'],['moov','trak','mdia','minf','stbl','stsd']]) {
    const a=find(original,path),b=find(result.bytes,path);
    expect(new Uint8Array(result.bytes.slice(b.start,b.end))).toEqual(new Uint8Array(original.slice(a.start,a.end)));
  }
  const chunk=find(result.bytes,['moov','trak','mdia','minf','stbl','stco']);
  expect(new DataView(result.bytes).getUint32(chunk.start+8)).toBe(find(result.bytes,['mdat']).start);
});
it('supports consecutive fragments and rejects decode gaps and overlapping data',()=>{
  const original=fixture(), moof=find(original,['moof']), once=prepareRecording(original,60000,maxSize);
  const mdhd=find(once.bytes,['moov','trak','mdia','mdhd']);
  const tail=new Uint8Array(original.slice(moof.offset)), tfdt=find(tail.buffer,['moof','traf','tfdt']);
  const ticks=new DataView(once.bytes).getUint32(mdhd.start+16);
  new DataView(tail.buffer).setUint32(tfdt.start+8,ticks);
  const doubled=new Uint8Array(original.byteLength+tail.length); doubled.set(new Uint8Array(original)); doubled.set(tail,original.byteLength);
  const twice=prepareRecording(doubled.buffer,60000,maxSize);
  expect(Math.abs(twice.duration-once.duration*2)).toBeLessThanOrEqual(1);
  const secondRun=original.byteLength+find(tail.buffer,['moof','traf','trun']).start+8;
  const oldOffset=new DataView(doubled.buffer).getInt32(secondRun);
  new DataView(doubled.buffer).setInt32(secondRun,find(original,['mdat']).start-original.byteLength);
  expect(()=>prepareRecording(doubled.buffer,60000,maxSize)).toThrow();
  new DataView(doubled.buffer).setInt32(secondRun,oldOffset);
  new DataView(doubled.buffer).setUint32(original.byteLength+tfdt.start+8,ticks+1);
  expect(()=>prepareRecording(doubled.buffer,60000,maxSize)).toThrow();
});
it.each([
  [['moof','traf','tfhd'],4,99], // wrong track
  [['moof','traf','trun'],4,0xffffffff], // excessive sample count
  [['moof','traf','trun'],8,1], // offset outside mdat
  [['moof','traf','trun'],12,0], // zero sample duration
  [['moof','traf','trun'],16,0xffffffff], // truncated sample payload
  [['moov','trak','mdia','hdlr'],8,0x76696465], // video
  [['moov','trak','mdia','minf','stbl','stsd'],4,2], // multiple codecs
  [['moov','trak','mdia','minf','dinf','dref'],4,2], // external/ambiguous references
] as [string[],number,number][])('fails closed for malformed or unsupported layout %j %i %i',(path,offset,value)=>{
  expect(()=>prepareRecording(change(path,offset,value),60000,maxSize)).toThrow();
});
it('retains duration/size enforcement, rejects truncation and preserves admitted progressive files',()=>{
  const bytes=fixture(), duration=prepareRecording(bytes,60000,maxSize).duration;
  expect(()=>prepareRecording(bytes,duration-1,maxSize)).toThrow();
  expect(()=>prepareRecording(bytes,60000,bytes.byteLength-1)).toThrow();
  expect(()=>prepareRecording(bytes.slice(0,-1),60000,maxSize)).toThrow();
  const progressive=admittedAudioFixture();expect(prepareRecording(progressive,60000,maxSize).bytes).toBe(progressive);
});
