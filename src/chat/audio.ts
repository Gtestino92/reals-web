import { flattenRecording } from './mp4Recording';

// Conservative ISO-BMFF admission check. The server still performs final validation.
// Uploads must have populated stsz/stco/stsc; recording fragments are finalized first.
export function inspectAudio(bytes: ArrayBuffer, maxDuration: number, maxSize: number): number {
  const v = new DataView(bytes), b = new Uint8Array(bytes);
  const fail = (): never => { throw new Error('Este navegador no produjo un audio MP4/AAC compatible. Usá mensajes de texto o Android.'); };
  if (!b.length || b.length > maxSize) return fail();
  const u32 = (p: number) => v.getUint32(p);
  const text = (p: number, n: number) => String.fromCharCode(...b.slice(p,p+n));
  interface Box { type: string; start: number; end: number }
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (start + 8 > end) return fail();
      const size = u32(start), type = text(start+4,4);
      if (size < 8 || start + size > end) return fail();
      result.push({ type, start: start+8, end: start+size }); start += size;
    }
    return result;
  };
  const top = boxes(0,b.length);
  if (top.some(x => x.type === 'moof')) return fail();
  const ftyp = top.find(x => x.type === 'ftyp'), moov = top.find(x => x.type === 'moov'), mdat = top.filter(x => x.type === 'mdat');
  if (!ftyp || !moov || !mdat.length || !['M4A ','M4B ','mp42','mp41','isom','iso2'].some(brand => text(ftyp.start,ftyp.end-ftyp.start).includes(brand))) return fail();
  const tracks = boxes(moov.start,moov.end).filter(x => x.type === 'trak');
  if (tracks.length !== 1) return fail();
  const track = tracks[0]; if (!track) return fail();
  const mdia = boxes(track.start,track.end).find(x => x.type === 'mdia'); if (!mdia) return fail();
  const children = boxes(mdia.start,mdia.end), hdlr = children.find(x => x.type === 'hdlr'), mdhd = children.find(x => x.type === 'mdhd'), minf = children.find(x => x.type === 'minf');
  if (!hdlr || text(hdlr.start+8,4) !== 'soun' || !mdhd || !minf || b[mdhd.start] !== 0) return fail();
  const scale = u32(mdhd.start+12), duration = u32(mdhd.start+16);
  if (!scale || !duration || duration*1000 > maxDuration*scale) return fail();
  const stbl = boxes(minf.start,minf.end).find(x => x.type === 'stbl'); if (!stbl) return fail();
  const tables = boxes(stbl.start,stbl.end), stsd = tables.find(x => x.type === 'stsd'), stsz = tables.find(x => x.type === 'stsz'), stsc = tables.find(x => x.type === 'stsc'), stco = tables.find(x => x.type === 'stco');
  if (!stsd || !stsz || !stsc || !stco || !u32(stsc.start+4) || !u32(stco.start+4) || !u32(stsz.start+8)) return fail();
  const entries = boxes(stsd.start+8,stsd.end), entry = entries[0];
  if (entries.length !== 1 || !entry || entry.type !== 'mp4a') return fail();
  const esds = boxes(entry.start+28,entry.end).find(x => x.type === 'esds'); if (!esds) return fail();
  let aac = false, config = false;
  const descriptors = (start: number, end: number) => {
    while (start < end) {
      const tag = b[start++]; let length = 0, done = false;
      for (let i=0;i<4;i++) { const n = b[start++]; if (n === undefined) return fail(); length = (length<<7) | (n&127); if (!(n&128)) { done=true; break; } }
      if (!done || start+length>end) return fail();
      if (tag === 3) descriptors(start+3,start+length);
      if (tag === 4) { aac = b[start] === 0x40; descriptors(start+13,start+length); }
      if (tag === 5) config = [2,5,29].includes((b[start] ?? 0)>>>3);
      start+=length;
    }
  };
  descriptors(esds.start+4,esds.end);
  const sampleSize = u32(stsz.start+4) || u32(stsz.start+12), chunk = u32(stco.start+8);
  if (!aac || !config || !sampleSize || !mdat.some(x => chunk >= x.start && chunk+sampleSize <= x.end)) return fail();
  return Math.ceil(duration*1000/scale);
}
export function recordingMime(): string | null {
  return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' ? ['audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) ?? null : null;
}

export function prepareRecording(bytes: ArrayBuffer, maxDuration: number, maxSize: number) {
  const fileBytes = flattenRecording(bytes,maxSize);
  return { bytes: fileBytes, duration: inspectAudio(fileBytes,maxDuration,maxSize) };
}
