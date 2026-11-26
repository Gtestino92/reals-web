import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Home } from './Home';
import { emptyHome, homeStatus } from './fixtures';
import { homeSecondFixture } from './secondHome.fixtures';
import { secondHarness } from '../chat/secondFixtures';
import { ApiError } from '../auth/api';
import { StartupBoundary } from '../SessionLoading';

function harness() {
  const h=secondHarness(),home=emptyHome(),item=homeSecondFixture(),base=h.request.getMockImplementation()!;
  Object.assign(item.secondChat!,{chatId:'c',chatStatus:'ACTIVE',myAttendanceStatus:'ON_TIME'});
  home.nextSteps=[{...item,partner:{displayName:'Nombre de Home'}}];
  h.request.mockImplementation(async (...args) => {
    if(args[0]==='/me/home')return structuredClone(home);
    if(args[0]==='/me/home/status')return homeStatus();
    if(args[0]==='/me/profile')return {id:'p',userId:h.controller.snapshot.account?.id,status:'ACTIVE',displayName:'Usuario'};
    if(args[0]==='/reference/affinity-questions')return {categories:[],questions:[]};
    if(args[0]==='/me/profile/affinity-answers')return [];
    return base(...args);
  });
  return {...h,home};
}
const postCount=(h:ReturnType<typeof harness>)=>h.request.mock.calls.filter(c=>c[2]==='POST').length;
it.each(['ON_TIME','PENDING'] as const)('restores joined active chat with partner %s, no Home flash or JOIN, one fresh load under StrictMode',async attendance=>{
  const h=harness();h.status.partnerAttendanceStatus=attendance;
  const push=vi.spyOn(history,'pushState');
  const view=render(<StrictMode><Home controller={h.controller}/></StrictMode>);
  expect(screen.queryByRole('button',{name:'Buscar chat'})).toBeNull();
  await screen.findByRole('textbox',{name:'Mensaje'});
  expect(screen.queryByRole('button',{name:'Volver a Inicio'})).toBeNull();
  expect(screen.queryByRole('heading',{name:'Inicio'})).toBeNull();
  expect(history.state.trail).toEqual(['home','second-chat']);expect(push).not.toHaveBeenCalled();push.mockRestore();
  expect(h.request.mock.calls.filter(c=>c[0].endsWith('/second-chat/status'))).toHaveLength(1);
  expect(h.request.mock.calls.filter(c=>c[0]==='/me/home')).toHaveLength(1);expect(postCount(h)).toBe(0);
  fireEvent(window,new PopStateEvent('popstate',{state:{owner:history.state.owner,trail:['home']}}));
  expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();
  view.unmount();await act(async()=>{});
  render(<Home controller={h.controller}/>);await screen.findByRole('textbox',{name:'Mensaje'});expect(postCount(h)).toBe(0);
});
it.each(['alone-after-cutoff','terminal','retention-expired','absolute-expired','unjoined-stale-home'] as const)('allows Home for %s without reentry loops',async kind=>{
  const h=harness();
  if(kind==='alone-after-cutoff'){h.status.partnerAttendanceStatus='PENDING';h.status.serverTime=h.status.entryClosesAt;}
  if(kind==='terminal'||kind==='retention-expired'){h.status.chatStatus='FINISHED';h.status.readOnlyUntil=kind==='terminal'?h.status.absoluteExpiresAt:h.status.serverTime;}
  if(kind==='absolute-expired')h.status.serverTime=h.status.absoluteExpiresAt;
  if(kind==='unjoined-stale-home')h.status.myAttendanceStatus='PENDING';
  render(<Home controller={h.controller}/>);await screen.findByRole('button',{name:'Buscar chat'});
  fireEvent(window,new Event('online'));await screen.findByRole('button',{name:'Buscar chat'});
  expect(screen.queryByRole('region',{name:'Segundo chat'})).toBeNull();expect(postCount(h)).toBe(0);
});
it('blocks retryably on status failure without refetching Home and never uses old History as authority',async()=>{
  const h=harness(),base=h.request.getMockImplementation()!;let fail=true;
  history.replaceState({owner:'old',trail:['home','second-chat'],connectionId:'other',matchId:'foreign'},'','/');
  h.request.mockImplementation(async(...args)=>{if(fail&&args[0].endsWith('/second-chat/status'))throw new ApiError('backend',503);return base(...args);});
  render(<Home controller={h.controller}/>);await screen.findByRole('alert');
  expect(screen.queryByRole('button',{name:'Buscar chat'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Volver a Inicio'})).toBeNull();fail=false;
  fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByRole('textbox',{name:'Mensaje'});
  expect(h.request.mock.calls.filter(c=>c[0]==='/me/home')).toHaveLength(1);expect(postCount(h)).toBe(0);
});
it('does not install obsolete restoration after account replacement or unmount',async()=>{
  const h=harness(),base=h.request.getMockImplementation()!;let release!:()=>void;
  h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/second-chat/status'))await new Promise<void>(r=>{release=r;});return base(...args);});
  const view=render(<Home controller={h.controller}/>);await waitFor(()=>expect(release).toBeDefined());
  h.controller.snapshot={...h.controller.snapshot,account:{id:'other',status:'ACTIVE'}};view.unmount();
  await act(async()=>release());expect(postCount(h)).toBe(0);expect(history.state.trail).not.toContain('second-chat');
});
it('uses the same chat shell through delayed passive history and the ready conversation',async()=>{
  const h=harness(),base=h.request.getMockImplementation()!,onChatActiveChange=vi.fn();
  let release!:()=>void;
  const historyReady=new Promise<void>(resolve=>{release=resolve;});
  h.request.mockImplementation(async(...args)=>{
    if(args[0].includes('/messages?'))await historyReady;
    return base(...args);
  });
  render(<Home controller={h.controller} onChatActiveChange={onChatActiveChange}/>);
  expect(await screen.findByText('Cargando el segundo chat…')).toBeInTheDocument();
  expect(onChatActiveChange).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('button',{name:'Buscar chat'})).toBeNull();
  onChatActiveChange.mockClear();
  await act(async()=>release());
  expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();
  expect(onChatActiveChange).not.toHaveBeenCalledWith(false);
  expect(postCount(h)).toBe(0);
});
it('holds the cold startup presentation through passive Second Chat restoration', async () => {
  const h = harness(), base = h.request.getMockImplementation()!;
  let release!: () => void;
  h.request.mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) await new Promise<void>(resolve => { release = resolve; });
    return base(...args);
  });
  render(<StrictMode><StartupBoundary><Home controller={h.controller} /></StartupBoundary></StrictMode>);
  const startup = screen.getByRole('status');
  await waitFor(() => expect(release).toBeDefined());
  expect(startup).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Inicio' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Mensaje' })).toBeNull();
  await act(async () => release());
  expect(await screen.findByRole('textbox', { name: 'Mensaje' })).toBeEnabled();
  expect(startup).not.toBeInTheDocument();
  expect(postCount(h)).toBe(0);
});
it('allows Home when a stale active Home item is authoritatively inaccessible',async()=>{
 const h=harness(),base=h.request.getMockImplementation()!;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/second-chat/status'))throw new ApiError('backend',404);return base(...args);});
 render(<Home controller={h.controller}/>);await screen.findByRole('button',{name:'Buscar chat'});expect(postCount(h)).toBe(0);
});
it('does not treat a malformed joined active snapshot without a chat ID as permission to leave',async()=>{
 const h=harness();h.status.chatId=null;render(<Home controller={h.controller}/>);
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Buscar chat'})).toBeNull();expect(postCount(h)).toBe(0);
});
