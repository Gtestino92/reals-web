// Synthetic ISO-BMFF admission fixture, not an audible recording or an encoder test.
export function admittedAudioFixture(durationMillis = 1000): ArrayBuffer {
  const join = (...parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
  };
  const word = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0,value); return bytes; };
  const text = (value: string) => new TextEncoder().encode(value);
  const box = (name: string, ...parts: Uint8Array[]) => { const payload = join(...parts); return join(word(payload.length+8), text(name), payload); };
  const header = new Uint8Array(24); const view = new DataView(header.buffer); view.setUint32(12,1000); view.setUint32(16,durationMillis);
  const ftyp = box('ftyp',text('M4A '),word(0),text('isom'));
  const samples = new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]);
  const moov = (offset: number) => box('moov',box('trak',box('mdia',box('mdhd',header),box('hdlr',word(0),word(0),text('soun')),box('minf',box('stbl',
    box('stsd',word(0),word(1),box('mp4a',new Uint8Array(28),box('esds',word(0),new Uint8Array([3,22,0,1,0,4,17,0x40,...new Uint8Array(12),5,2,0x12,0x10])))),
    box('stsz',word(0),word(samples.length),word(1)),box('stsc',word(0),word(1),word(1),word(1),word(1)),box('stco',word(0),word(1),word(offset)))))));
  const result = join(ftyp,moov(ftyp.length+moov(0).length+8),box('mdat',samples));
  return result.slice().buffer;
}
