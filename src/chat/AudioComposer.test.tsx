import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioComposer } from './AudioComposer';
import { chatFixture } from './fixtures';
import { admittedAudioFixture } from './audio.test-support';
import { inspectAudio } from './audio';
import { StrictMode } from 'react';
class Recorder {
  static isTypeSupported = () => true;
  static last:Recorder;
  static output:BlobPart='incompatible bytes';
  state='inactive'; mimeType='audio/mp4';
  onstop:(()=>void)|null=null; onerror:(()=>void)|null=null; ondataavailable:((e:{data:Blob})=>void)|null=null;
  constructor(){Recorder.last=this;}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([Recorder.output])});this.onstop?.();}
}
let stop:ReturnType<typeof vi.fn>, get:ReturnType<typeof vi.fn>, send:ReturnType<typeof vi.fn<(file: Blob) => void>>;
beforeEach(()=>{stop=vi.fn();send=vi.fn();get=vi.fn().mockResolvedValue({getTracks:()=>[{stop}]});Recorder.output='incompatible bytes';vi.stubGlobal('MediaRecorder',Recorder);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:get}});
  Object.defineProperty(Blob.prototype,'arrayBuffer',{configurable:true,value:function(this:Blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(this);});}});
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:synthetic-audio')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();Reflect.deleteProperty(navigator,'mediaDevices');});
const mount=()=>render(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);
it('requests only microphone access after an explicit gesture',async()=>{mount();expect(get).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');expect(get).toHaveBeenCalledWith({audio:true,video:false});});
it('permission denial is actionable and never uploads',async()=>{get.mockRejectedValue(new DOMException('denied','NotAllowedError'));mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));expect(await screen.findByRole('alert')).toHaveTextContent('Permití su uso');expect(send).not.toHaveBeenCalled();});
it('stops all microphone tracks on cancel',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Cancelar grabación'}));expect(stop).toHaveBeenCalled();expect(screen.queryByRole('timer')).toBeNull();expect(send).not.toHaveBeenCalled();});
it('stops tracks on unmount and ignores late callbacks',async()=>{const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');view.unmount();expect(stop).toHaveBeenCalled();expect(send).not.toHaveBeenCalled();});
it('releases permission results arriving after unmount',async()=>{let resolve:((stream:unknown)=>void)|undefined;get.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));view.unmount();await act(async()=>resolve?.({getTracks:()=>[{stop}]}));expect(stop).toHaveBeenCalled();});
it('does not claim that isTypeSupported proves actual byte compatibility',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('no produjo MP4/AAC compatible'));expect(screen.getByRole('button',{name:'Grabar audio'})).toBeDisabled();expect(send).not.toHaveBeenCalled();});
it('honors server guidance gate before asking for permissions',()=>{render(<AudioComposer policy={{...chatFixture().audioPolicy,enabled:false,unavailableReason:'GUIDANCE_REQUIRED'}} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);expect(screen.getByText(/Avancen en las preguntas/)).toBeVisible();expect(screen.queryByRole('button',{name:'Grabar audio'})).toBeNull();expect(get).not.toHaveBeenCalled();});
it('admits the structural fixture and exposes a preview only after byte inspection',async()=>{
  Recorder.output=admittedAudioFixture();expect(inspectAudio(Recorder.output,60000,2097152)).toBe(1000);
  mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));
  expect(await screen.findByLabelText('Vista previa del audio')).toBeVisible();expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Eliminar grabación'}));expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-audio');expect(screen.queryByLabelText('Vista previa del audio')).toBeNull();
});
it('validates and sends once directly from recording and retains draft until exact confirmation',async()=>{
  Recorder.output=admittedAudioFixture();const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');
  fireEvent.click(screen.getByRole('button',{name:'Enviar audio'}));await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
  const file=send.mock.calls[0]![0];expect(file.type).toBe('audio/mp4');expect(screen.getByLabelText('Vista previa del audio')).toBeVisible();
  view.rerender(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}} confirmedFile={new Blob()}/>);expect(screen.getByLabelText('Vista previa del audio')).toBeVisible();
  view.rerender(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}} confirmedFile={file}/>);await waitFor(()=>expect(screen.queryByLabelText('Vista previa del audio')).toBeNull());
});
it('keeps a failed audio draft and locks deletion while delivery is uncertain',async()=>{
  Recorder.output=admittedAudioFixture();send.mockImplementation(()=>{throw new Error('Synthetic failure');});const view=mount();
  fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));await screen.findByLabelText('Vista previa del audio');
  fireEvent.click(screen.getByRole('button',{name:'Enviar audio'}));expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos enviar');expect(screen.getByLabelText('Vista previa del audio')).toBeVisible();
  view.rerender(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}} payloadLocked delivery="uncertain"/>);
  expect(screen.getByRole('button',{name:'Eliminar grabación'})).toBeDisabled();expect(screen.getByRole('button',{name:'Enviar audio'})).toBeDisabled();
});
it('cancels recording and stops tracks on background transition',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');fireEvent(document,new Event('visibilitychange'));
  expect(stop).toHaveBeenCalled();expect(screen.queryByRole('timer')).toBeNull();expect(send).not.toHaveBeenCalled();visibility.mockRestore();
});
it('cancels a pending permission request and releases the late stream without recording',async()=>{
  let resolve:((stream:unknown)=>void)|undefined;get.mockImplementation(()=>new Promise(r=>{resolve=r;}));mount();
  fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));expect(screen.getByRole('status')).toHaveTextContent('Esperando permiso');
  fireEvent.click(screen.getByRole('button',{name:'Cancelar grabación'}));await act(async()=>resolve?.({getTracks:()=>[{stop}]}));
  expect(stop).toHaveBeenCalled();expect(screen.queryByRole('timer')).toBeNull();expect(send).not.toHaveBeenCalled();
});
it('shows upload progress and rejects rapid repeated sends until completion',async()=>{
  Recorder.output=admittedAudioFixture();let finish:(()=>void)|undefined;send.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));await screen.findByLabelText('Vista previa del audio');
  const button=screen.getByRole('button',{name:'Enviar audio'});fireEvent.click(button);fireEvent.click(button);
  expect(send).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();expect(screen.getByRole('progressbar',{name:'Envío de audio'})).not.toHaveAttribute('value');
  await act(async()=>finish?.());expect(screen.getByLabelText('Vista previa del audio')).toBeVisible();
});
it('disables recording when the server quota is exhausted',()=>{
  render(<AudioComposer policy={{...chatFixture().audioPolicy,remainingMessages:0}} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Grabar audio'})).toBeDisabled();expect(get).not.toHaveBeenCalled();
});
it('does not duplicate permission or recording under StrictMode and cancels cleanly',async()=>{
  const view=render(<StrictMode><AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={send} onDirtyChange={()=>{}}/></StrictMode>);
  const mic=screen.getByRole('button',{name:'Grabar audio'});expect(mic.querySelector('svg')).not.toBeNull();expect(mic.textContent).toBe('');
  fireEvent.click(mic);await screen.findByRole('timer');expect(get).toHaveBeenCalledTimes(1);view.unmount();expect(stop).toHaveBeenCalledTimes(1);
});
it('uses the inspected Android send disposition at the recording limit after validating bytes',async()=>{
  vi.useFakeTimers();Recorder.output=admittedAudioFixture();
  render(<AudioComposer policy={{...chatFixture().audioPolicy,maxDurationMillis:2000}} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));});
  expect(screen.getByRole('timer')).toHaveTextContent('/ 2 s');
  await act(async()=>{await vi.advanceTimersByTimeAsync(1600);});vi.useRealTimers();
  await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(stop).toHaveBeenCalled();
});
it('cancels active recording when a refreshed authoritative quota removes eligibility',async()=>{
  const view=mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');const old=Recorder.last;
  view.rerender(<AudioComposer policy={{...chatFixture().audioPolicy,remainingMessages:0}} disabled={false} onSend={send} onDirtyChange={()=>{}}/>);
  expect(screen.queryByRole('timer')).toBeNull();expect(stop).toHaveBeenCalled();await act(async()=>old.onstop?.());expect(send).not.toHaveBeenCalled();
});
it('retains the send intent callback while stop/byte validation is asynchronous',async()=>{
  Recorder.output=admittedAudioFixture();const other=vi.fn();const view=mount();
  fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Enviar audio'}));
  view.rerender(<AudioComposer policy={chatFixture().audioPolicy} disabled={false} onSend={other} onDirtyChange={()=>{}}/>);
  await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(other).not.toHaveBeenCalled();
});
it('reports preview playback errors without discarding the validated audio',async()=>{
  Recorder.output=admittedAudioFixture();mount();fireEvent.click(screen.getByRole('button',{name:'Grabar audio'}));await screen.findByRole('timer');fireEvent.click(screen.getByRole('button',{name:'Detener'}));
  const audio=await screen.findByLabelText('Vista previa del audio');fireEvent.error(audio);expect(screen.getByRole('alert')).toHaveTextContent('No pudimos reproducir');expect(audio).toBeVisible();expect(screen.getByRole('button',{name:'Eliminar grabación'})).toBeEnabled();
});
