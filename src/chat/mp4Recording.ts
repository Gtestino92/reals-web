// Flatten a single-track fragmented AAC recording into ordinary M4A sample tables.
// Encoded samples and codec configuration are copied byte-for-byte, never decoded
// or transcoded. Unsupported layouts fail closed; audio.ts validates the result.
export function flattenRecording(bytes: ArrayBuffer, maxSize: number): ArrayBuffer {
  const data = new Uint8Array(bytes), view = new DataView(bytes);
  const fail = (): never => { throw new Error('Contenedor de audio no compatible.'); };
  if (!data.length || data.length > maxSize) return fail();
  const u32 = (p: number) => { if (p < 0 || p + 4 > data.length) return fail(); return view.getUint32(p); };
  const u64 = (p: number) => { const n = u32(p) * 4294967296 + u32(p + 4); if (!Number.isSafeInteger(n)) return fail(); return n; };
  const word = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return fail(); const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0,n); return out; };
  const join = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n,p) => n+p.length,0)); let offset=0; for (const p of parts) { out.set(p,offset); offset+=p.length; } return out; };
  const box = (type: string, ...parts: Uint8Array[]) => { const body=join(parts); return join([word(body.length+8),new TextEncoder().encode(type),body]); };
  interface Box { type: string; offset: number; start: number; end: number }
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (start+8 > end) return fail();
      const size=u32(start), type=String.fromCharCode(...data.subarray(start+4,start+8));
      if (size<8 || start+size>end) return fail();
      result.push({type,offset:start,start:start+8,end:start+size}); start+=size;
    }
    return result;
  };
  const one = (list: Box[], type: string) => { const matches=list.filter(b=>b.type===type); if (matches.length!==1 || !matches[0]) return fail(); return matches[0]; };
  const raw = (b: Box) => data.slice(b.offset,b.end);
  const body = (b: Box) => data.slice(b.start,b.end);
  // Chrome uses version-1 headers even for short recordings. Emit version 0
  // (bounded duration/size) while retaining track ID, timescale and layout fields.
  const header = (b: Box, track = false) => {
    if (data[b.start]===0) { if (b.end-b.start<24) return fail(); return body(b); }
    if (data[b.start]!==1 || b.end-b.start<36) return fail();
    return join([word(u32(b.start)&0xffffff),word(0),word(0),data.slice(b.start+20,b.start+24),...(track?[data.slice(b.start+24,b.start+28)]:[]),word(0),data.slice(b.start+(track?36:32),b.end)]);
  };
  const top=boxes(0,data.length);
  if (!top.some(b=>b.type==='moof')) return bytes;
  const moov=one(top,'moov'), movie=boxes(moov.start,moov.end), trak=one(movie,'trak');
  const track=boxes(trak.start,trak.end), tkhd=one(track,'tkhd'), mdia=one(track,'mdia');
  const media=boxes(mdia.start,mdia.end), mdhd=one(media,'mdhd'), hdlr=one(media,'hdlr'), minf=one(media,'minf');
  if (track.some(b=>b.type==='edts') || hdlr.end-hdlr.start<12 || String.fromCharCode(...data.subarray(hdlr.start+8,hdlr.start+12))!=='soun') return fail();
  const trackHeader=header(tkhd,true), mediaHeader=header(mdhd);
  const trackView=new DataView(trackHeader.buffer), mediaView=new DataView(mediaHeader.buffer);
  const mediaInfo=boxes(minf.start,minf.end), stbl=one(mediaInfo,'stbl'), tables=boxes(stbl.start,stbl.end), stsd=one(tables,'stsd');
  if (stsd.end-stsd.start<8 || u32(stsd.start+4)!==1) return fail();
  const codec=one(boxes(stsd.start+8,stsd.end),'mp4a');
  if (codec.end!==stsd.end || codec.end-codec.start<28 || boxes(codec.start+28,codec.end).some(b=>!['esds','btrt'].includes(b.type))) return fail();
  const dinf=one(mediaInfo,'dinf'), dref=one(boxes(dinf.start,dinf.end),'dref');
  if (dref.end-dref.start<8 || u32(dref.start+4)!==1) return fail();
  const url=one(boxes(dref.start+8,dref.end),'url ');
  if (url.end-url.start<4 || u32(url.start)!==1) return fail();
  const mvex=one(movie,'mvex'), trex=one(boxes(mvex.start,mvex.end),'trex');
  if (trex.end-trex.start!==24 || u32(trex.start)!==0 || u32(trex.start+4)!==trackView.getUint32(12) || u32(trex.start+8)!==1) return fail();
  const trackId=u32(trex.start+4), scale=mediaView.getUint32(12);
  if (!scale) return fail();
  const samples: Uint8Array[] = [], sizes: number[] = [], durations: number[] = [];
  let duration=0, payloadSize=0, decodeEnd: number | null=null, lastDataEnd=0;
  for (const moof of top.filter(b=>b.type==='moof')) {
    const traf=one(boxes(moof.start,moof.end),'traf'), fragments=boxes(traf.start,traf.end), tfhd=one(fragments,'tfhd'), tfdt=one(fragments,'tfdt');
    if (tfhd.end-tfhd.start<8 || data[tfhd.start]!==0 || u32(tfhd.start+4)!==trackId || fragments.some(b=>!['tfhd','tfdt','trun'].includes(b.type))) return fail();
    const flags=u32(tfhd.start)&0xffffff;
    if (flags & ~0x02003b || flags & 0x010000) return fail();
    let pos=tfhd.start+8, base=moof.offset, defaultDuration=u32(trex.start+12), defaultSize=u32(trex.start+16);
    if (flags&1) { base=u64(pos); pos+=8; }
    if (flags&2) { if (u32(pos)!==1) return fail(); pos+=4; }
    if (flags&8) { defaultDuration=u32(pos); pos+=4; }
    if (flags&16) { defaultSize=u32(pos); pos+=4; }
    if (flags&32) pos+=4;
    if (pos!==tfhd.end || tfdt.end-tfdt.start!==(data[tfdt.start]===1?12:8) || ![0,1].includes(data[tfdt.start] ?? -1)) return fail();
    const decode=data[tfdt.start]===1?u64(tfdt.start+4):u32(tfdt.start+4);
    if (decodeEnd!==null && decode!==decodeEnd) return fail();
    let fragmentDuration=0, dataEnd: number | null=null;
    const runs=fragments.filter(b=>b.type==='trun'); if (!runs.length) return fail();
    for (const run of runs) {
      if (run.end-run.start<8 || ![0,1].includes(data[run.start] ?? -1)) return fail();
      const runFlags=u32(run.start)&0xffffff, count=u32(run.start+4);
      if (runFlags&~0xf05 || !count || sizes.length+count>100000) return fail();
      let cursor=run.start+8;
      let offset: number | null=dataEnd;
      if (runFlags&1) { u32(cursor); offset=base+view.getInt32(cursor); cursor+=4; }
      if (runFlags&4) cursor+=4;
      if (offset===null) return fail();
      for (let i=0;i<count;i++) {
        const ticks=runFlags&0x100?u32(cursor):defaultDuration; if (runFlags&0x100) cursor+=4;
        const size=runFlags&0x200?u32(cursor):defaultSize; if (runFlags&0x200) cursor+=4;
        if (runFlags&0x400) cursor+=4;
        if (runFlags&0x800) { if (u32(cursor)!==0) return fail(); cursor+=4; }
        const sampleOffset=offset;
        if (!ticks || !size || sampleOffset<lastDataEnd || !top.some(b=>b.type==='mdat' && sampleOffset>=b.start && sampleOffset+size<=b.end)) return fail();
        payloadSize+=size; if (payloadSize>maxSize) return fail();
        samples.push(data.slice(offset,offset+size)); sizes.push(size); durations.push(ticks);
        offset+=size; lastDataEnd=offset; fragmentDuration+=ticks;
      }
      if (cursor!==run.end) return fail();
      dataEnd=offset;
    }
    duration+=fragmentDuration; decodeEnd=decode+fragmentDuration;
    if (duration>0xffffffff || !Number.isSafeInteger(decodeEnd)) return fail();
  }
  if (!samples.length) return fail();
  const ftyp=box('ftyp',new TextEncoder().encode('M4A '),word(0),new TextEncoder().encode('isommp42'));
  const times: number[]=[];
  for (const ticks of durations) { if (times.length && times[times.length-1]===ticks) times[times.length-2]=(times[times.length-2] ?? 0)+1; else times.push(1,ticks); }
  const table=box('stbl',raw(stsd),box('stts',word(0),word(times.length/2),join(times.map(word))),
    box('stsc',word(0),word(1),word(1),word(samples.length),word(1)),box('stsz',word(0),word(0),word(sizes.length),join(sizes.map(word))),box('stco',word(0),word(1),word(ftyp.length+8)));
  mediaView.setUint32(16,duration);
  const mvhd=one(movie,'mvhd'), movieHeader=header(mvhd), movieScale=new DataView(movieHeader.buffer).getUint32(12); if (!movieScale) return fail();
  const movieTicks=Math.ceil(duration*movieScale/scale);
  word(movieTicks); new DataView(movieHeader.buffer).setUint32(16,movieTicks); new DataView(trackHeader.buffer).setUint32(20,movieTicks);
  const flattened=join([ftyp,box('mdat',join(samples)),box('moov',box('mvhd',movieHeader),box('trak',box('tkhd',trackHeader),box('mdia',box('mdhd',mediaHeader),raw(hdlr),box('minf',...mediaInfo.filter(b=>b.type!=='stbl').map(raw),table))))]);
  if (flattened.length>maxSize) return fail();
  return flattened.buffer;
}
