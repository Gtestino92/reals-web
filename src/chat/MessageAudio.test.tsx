import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MessageAudio } from './MessageAudio';

let play: ReturnType<typeof vi.spyOn>;
beforeEach(()=>{
  play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
});
const mount=(refresh:()=>Promise<string | null>=vi.fn(async()=> 'https://media.test/renewed'))=>render(<StrictMode><MessageAudio source="https://media.test/original" durationMillis={7000} refresh={refresh}/></StrictMode>);
const audio=()=>document.querySelector('audio')!;
const start=async()=>{fireEvent.click(screen.getByRole('button',{name:'Reproducir audio'}));await act(async()=>{});return audio();};
const metadata=(a: HTMLAudioElement)=>{Object.defineProperty(a,'duration',{configurable:true,value:7});fireEvent.loadedMetadata(a);};
it('retains a source under StrictMode and waits for playing evidence',async()=>{
  mount();expect(document.querySelector('audio')).toBeNull();const a=await start();expect(a.src).toBe('https://media.test/original');expect(play).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status',{name:'Cargando audio'})).toBeVisible();expect(screen.queryByRole('button',{name:'Pausar audio'})).toBeNull();
  metadata(a);fireEvent.playing(a);expect(screen.getByRole('button',{name:'Pausar audio'})).toBeVisible();expect(screen.getByRole('slider')).toBeEnabled();
});
it('supports pause, resume, seek, ended and replay from the start',async()=>{
  mount();const a=await start();metadata(a);fireEvent.playing(a);a.currentTime=2;fireEvent.timeUpdate(a);
  expect(screen.getByLabelText('Tiempo de audio')).toHaveTextContent('0:02 / 0:07');fireEvent.click(screen.getByRole('button',{name:'Pausar audio'}));
  fireEvent.click(screen.getByRole('button',{name:'Reproducir audio'}));const b=audio();metadata(b);expect(b.currentTime).toBe(2);fireEvent.playing(b);
  fireEvent.change(screen.getByRole('slider'),{target:{value:'4'}});expect(b.currentTime).toBe(4);
  fireEvent.ended(b);fireEvent.click(screen.getByRole('button',{name:'Reproducir audio de nuevo'}));const c=audio();metadata(c);expect(c.currentTime).toBe(0);
});
it('does not restart working playback when polling changes signed URLs',async()=>{
  const refresh=vi.fn(async()=>null),view=mount(refresh);const a=await start();metadata(a);fireEvent.playing(a);
  view.rerender(<StrictMode><MessageAudio source="https://media.test/fresh" durationMillis={7000} refresh={refresh}/></StrictMode>);
  expect(audio()).toBe(a);expect(a.src).toBe('https://media.test/original');expect(play).toHaveBeenCalledTimes(1);expect(refresh).not.toHaveBeenCalled();
});
it('renews once after an unsupported/network media response and reports persistent failure',async()=>{
  const refresh=vi.fn(async()=> 'https://media.test/new'),view=mount(refresh);const a=await start();Object.defineProperty(a,'error',{value:{code:4}});fireEvent.error(a);
  await waitFor(()=>expect(audio()).not.toBe(a));expect(refresh).toHaveBeenCalledTimes(1);const b=audio();Object.defineProperty(b,'error',{value:{code:4}});fireEvent.error(b);
  await screen.findByRole('alert');expect(refresh).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Renovar enlace'})).toBeVisible();view.unmount();expect(b.getAttribute('src')).toBeNull();
});
it('reports decode failure separately and allows an explicit URL recovery',async()=>{
  const refresh=vi.fn(async()=> 'https://media.test/new');mount(refresh);const a=await start();Object.defineProperty(a,'error',{value:{code:3}});fireEvent.error(a);
  expect(screen.getByRole('alert')).toHaveTextContent('decodificar');expect(refresh).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Renovar enlace'}));
  await waitFor(()=>expect(audio()).not.toBe(a));metadata(audio());fireEvent.playing(audio());expect(screen.queryByRole('alert')).toBeNull();
});
it('does not claim successful playback or renew a URL for an autoplay rejection',async()=>{
  play.mockRejectedValue(new DOMException('blocked','NotAllowedError'));const refresh=vi.fn(async()=>null);mount(refresh);await start();
  expect(await screen.findByRole('alert')).toHaveTextContent('bloqueó');expect(refresh).not.toHaveBeenCalled();
});
it('abandons a delayed renewal on cancellation and ignores obsolete events',async()=>{
  let resolve:((url:string)=>void)|undefined;const refresh=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));mount(refresh);const a=await start();Object.defineProperty(a,'error',{value:{code:2}});fireEvent.error(a);
  fireEvent.click(screen.getByRole('button',{name:'Cancelar carga de audio'}));await act(async()=>resolve?.('https://media.test/late'));fireEvent.playing(a);
  expect(document.querySelector('audio')).toBeNull();expect(screen.queryByRole('button',{name:'Pausar audio'})).toBeNull();expect(play).toHaveBeenCalledTimes(1);
});
it('pauses when another player starts or the page hides and cleans up on unmount',async()=>{
  const view=mount();const a=await start();metadata(a);fireEvent.playing(a);const other=document.createElement('audio');document.body.append(other);fireEvent.play(other);
  expect(screen.getByRole('button',{name:'Reproducir audio'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Reproducir audio'}));const b=audio();metadata(b);fireEvent.playing(b);
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');fireEvent(document,new Event('visibilitychange'));expect(screen.getByRole('button',{name:'Reproducir audio'})).toBeVisible();
  view.unmount();expect(b.src).toBe('');other.remove();visibility.mockRestore();
});
it('switching playback abandons a pending URL renewal and unmount ignores late results',async()=>{
  let resolve:((url:string)=>void)|undefined;const refresh=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));const view=mount(refresh);
  const a=await start();Object.defineProperty(a,'error',{value:{code:4}});fireEvent.error(a);
  const other=document.createElement('audio');document.body.append(other);fireEvent.play(other);
  await act(async()=>resolve?.('https://media.test/obsolete'));expect(document.querySelector('.chat-playback audio')).toBeNull();expect(play).toHaveBeenCalledTimes(1);
  view.unmount();other.remove();
});
it('a cancelled pending play promise cannot restart media and a refresh failure is actionable',async()=>{
  let reject:((error:unknown)=>void)|undefined;play.mockImplementation(()=>new Promise<void>((_,r)=>{reject=r;}));
  const refresh=vi.fn(async()=>{throw Error('Synthetic network failure');});mount(refresh);await start();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar carga de audio'}));await act(async()=>reject?.(new DOMException('cancelled','AbortError')));
  expect(screen.queryByRole('alert')).toBeNull();play.mockResolvedValue();await start();const a=audio();Object.defineProperty(a,'error',{value:{code:4}});fireEvent.error(a);
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Renovar enlace'}));expect(await screen.findByRole('alert')).toHaveTextContent('renovar');
});

it('preserves renewal intent when Chrome pauses loading media before reporting an expired URL',async()=>{
 const refresh=vi.fn(async()=>'https://media.test/renewed');mount(refresh);const a=await start();fireEvent.pause(a);Object.defineProperty(a,'error',{value:{code:4}});fireEvent.error(a);await waitFor(()=>expect(audio()).not.toBe(a));expect(refresh).toHaveBeenCalledOnce();expect(audio().src).toBe('https://media.test/renewed');
});
