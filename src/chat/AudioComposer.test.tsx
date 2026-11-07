import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioComposer } from './AudioComposer';
import { chatFixture } from './fixtures';
class Recorder {
  static isTypeSupported = () => true;
  static last:Recorder;
  state='inactive'; mimeType='audio/mp4';
  onstop:(()=>void)|null=null; onerror:(()=>void)|null=null; ondataavailable:((e:{data:Blob})=>void)|null=null;
  constructor(){Recorder.last=this;}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['incompatible bytes'])});this.onstop?.();}
}
let stop:ReturnType<typeof vi.fn>, get:ReturnType<typeof vi.fn>, send:ReturnType<typeof vi.fn<(file: Blob) => void>>;
beforeEach(()=>{stop=vi.fn();send=vi.fn();get=vi.fn().mockResolvedValue({getTracks:()=>[{stop}]});vi.stubGlobal('MediaRecorder',Recorder);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:get}});});
afterEach(()=>{vi.unstubAllGlobals();Reflect.deleteProperty(navigator,'mediaDevices');});
const mount=()=>render(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);
it('requests only microphone access after an explicit gesture',async()=>{mount();expect(get).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');expect(get).toHaveBeenCalledWith({audio:true,video:false});});
it('permission denial is actionable and never uploads',async()=>{get.mockRejectedValue(new DOMException('denied','NotAllowedError'));mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));expect(await screen.findByRole('alert')).toHaveTextContent('Permití su uso');expect(send).not.toHaveBeenCalled();});
it('stops all microphone tracks on cancel',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Cancelar grabación'}));expect(stop).toHaveBeenCalled();expect(screen.queryByRole('timer')).toBeNull();expect(send).not.toHaveBeenCalled();});
it('stops tracks on unmount and ignores late callbacks',async()=>{const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');view.unmount();expect(stop).toHaveBeenCalled();expect(send).not.toHaveBeenCalled();});
it('releases permission results arriving after unmount',async()=>{let resolve:((stream:unknown)=>void)|undefined;get.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));view.unmount();await act(async()=>resolve?.({getTracks:()=>[{stop}]}));expect(stop).toHaveBeenCalled();});
it('does not claim that isTypeSupported proves actual byte compatibility',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('no produjo MP4/AAC compatible'));expect(screen.getByRole('button',{name:'Grabar audio'})).toBeDisabled();expect(send).not.toHaveBeenCalled();});
it('honors server guidance gate before asking for permissions',()=>{render(<AudioComposer policy={{...chatFixture().audioPolicy,enabled:false,unavailableReason:'GUIDANCE_REQUIRED'}} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);expect(screen.getByText(/Avancen en las preguntas/)).toBeVisible();expect(screen.queryByRole('button',{name:'Grabar audio'})).toBeNull();expect(get).not.toHaveBeenCalled();});
