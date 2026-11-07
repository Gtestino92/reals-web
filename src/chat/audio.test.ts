import { expect, it, vi, afterEach } from 'vitest';
import { inspectAudio, recordingMime } from './audio';
afterEach(()=>vi.unstubAllGlobals());
it('does not infer native recording support from the user agent',()=>{vi.stubGlobal('MediaRecorder',undefined);expect(recordingMime()).toBeNull();});
it('requests only native MP4 AAC candidates',()=>{const supported=vi.fn((mime:string)=>mime==='audio/mp4');vi.stubGlobal('MediaRecorder',{isTypeSupported:supported});expect(recordingMime()).toBe('audio/mp4');expect(supported.mock.calls.every(([s])=>s.startsWith('audio/mp4'))).toBe(true);});
it.each([new Uint8Array(),new Uint8Array([0x1a,0x45,0xdf,0xa3]),new TextEncoder().encode('not mp4'),new Uint8Array(16)])('rejects empty, WebM, renamed, and malformed bytes',b=>{expect(()=>inspectAudio(b.buffer,60000,2097152)).toThrow();});
it('rejects oversized bytes before inspection',()=>{expect(()=>inspectAudio(new ArrayBuffer(100),60000,99)).toThrow();});
it('rejects fragmented output even if labeled MP4',()=>{const b=new ArrayBuffer(8),v=new DataView(b);v.setUint32(0,8);new Uint8Array(b).set(new TextEncoder().encode('moof'),4);expect(()=>inspectAudio(b,60000,2097152)).toThrow();});
