import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp } from '../App';
import { ApiClient } from './api';
import type { AuthService, Identity } from './firebase';
import { SessionController } from './session';
import { validStatement } from './suspension';
import { TabOwnershipManager } from '../tabs/TabOwnershipManager';
vi.mock('../onboarding/Onboarding', () => ({ Onboarding: ({ controller }: { controller: SessionController }) => <p>Perfil confirmado: {controller.snapshot.profile?.status}</p> }));
const deleted = { id: 'u', status: 'DELETED', deletedAt: '2026-11-01T00:00:00Z', deletionFinalizesAt: '2026-12-01T00:00:00Z' };
const active = { id: 'u', status: 'ACTIVE' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let observer: (user: Identity | null) => void, user: Identity, auth: AuthService, fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  user = { uid: 'f', emailVerified: true, reload: vi.fn(), getIdToken: vi.fn().mockResolvedValue('synthetic') };
  auth = { observe: vi.fn(next => { observer = next; return () => {}; }), signIn: vi.fn(), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>();
});

const banned = (code = 'ACCOUNT_PERMANENTLY_BANNED', expiresAt?: string) => json({code, expiresAt},403);
const appeal = (status = 'AVAILABLE', banActive = status !== 'APPROVED') => json({status,banActive});
const click = (name: string) => fireEvent.click(screen.getByRole('button',{name}));
async function mount(status = 'AVAILABLE') {
  fetcher.mockResolvedValueOnce(banned()).mockResolvedValueOnce(appeal(status));
  render(<StrictMode><OperationalApp firebase={{service:auth,localVerification:false}} api={new ApiClient(fetcher)}/></StrictMode>);
  act(()=>observer(user));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Actualizar estado'})).toBeEnabled());
}
function draft(value='Solicito revisión') { fireEvent.change(screen.getByRole('textbox'),{target:{value}}); }
it.each([undefined,'bad','2026-02-31T00:00:00Z','2020-01-01T00:00:00Z','2030-01-01T00:00:00Z'])('temporary suspension handles %s without clock transitions',async expiresAt=>{
  fetcher.mockResolvedValueOnce(banned('ACCOUNT_TEMPORARILY_BANNED',expiresAt));
  render(<OperationalApp firebase={{service:auth,localVerification:false}} api={new ApiClient(fetcher)}/>);act(()=>observer(user));
  expect(await screen.findByRole('heading',{name:'Cuenta suspendida temporalmente'})).toHaveFocus();
  expect(screen.queryByText(/Vencimiento informado/)!==null).toBe(!!expiresAt && !['bad','2026-02-31T00:00:00Z'].includes(expiresAt));
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockResolvedValueOnce(banned('ACCOUNT_TEMPORARILY_BANNED',expiresAt));click('Actualizar estado');
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Actualizar estado'})).toBeEnabled());
  fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({id:'p',userId:'u',status:'DRAFT'}));click('Actualizar estado');
  await screen.findByText('Perfil confirmado: DRAFT');
});
it.each(['AVAILABLE','PENDING','REJECTED'])('loads %s without normal endpoints or writes; Back stays restricted',async status=>{
  await mount(status);expect(fetcher.mock.calls.map(([p])=>p)).toEqual(['/api/me','/api/me/ban/appeal']);
  expect(screen.queryByRole('textbox')!==null).toBe(status==='AVAILABLE');fireEvent.popState(window);
  expect(screen.queryByText(/Perfil confirmado/)).toBeNull();expect(auth.signOut).not.toHaveBeenCalled();
});
it('accepts 201, excludes synchronous duplicates and installs GET state instead of POST body',async()=>{
  await mount();draft('  Solicito revisión  ');
  let finish!: (r:Response)=>void;fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(appeal('PENDING'));
  click('Solicitar revisión');click('Solicitar revisión');await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({statement:'Solicito revisión'});
  await act(async()=>finish(appeal('AVAILABLE'))); // Wrong HTTP status is uncertain and still reconciles.
  await screen.findByRole('heading',{name:'Revisión solicitada'});expect(fetcher.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
});
it.each(['201','offline','conflict','401'])('reconciles %s POST without replay',async mode=>{
  await mount();draft();
  if(mode==='offline')fetcher.mockRejectedValueOnce(new TypeError());
  else fetcher.mockResolvedValueOnce(mode==='201'?json({status:'PENDING',banActive:true},201):json({code:mode==='401'?'INVALID_TOKEN':'PENALTY_APPEAL_ALREADY_SUBMITTED'},mode==='401'?401:409));
  fetcher.mockResolvedValueOnce(appeal('PENDING'));click('Solicitar revisión');await screen.findByRole('heading',{name:'Revisión solicitada'});
  expect(fetcher.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
});
it('retains draft and uncertainty across failed reconciliation; only GET unlocks another action',async()=>{
  await mount();draft();fetcher.mockRejectedValueOnce(new TypeError()).mockRejectedValueOnce(new TypeError());click('Solicitar revisión');await screen.findByRole('alert');
  expect(screen.getByRole('textbox')).toHaveValue('Solicito revisión');expect(screen.getByRole('button',{name:'Solicitar revisión'})).toBeDisabled();
  fetcher.mockResolvedValueOnce(appeal());click('Actualizar estado');await waitFor(()=>expect(screen.getByRole('button',{name:'Solicitar revisión'})).toBeEnabled());
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('GET');
});
it('rejects oversized controller input', () => { expect(validStatement('a'.repeat(1001))).toBe(false); expect(validStatement('a'.repeat(1000))).toBe(true); });
it('validates UTF-16 boundaries, plain text and trimmed blank statements',async()=>{
  await mount();
  for(const value of ['   ','<tag>','a\tb','a\u0085b']) {draft(value);expect(screen.getByRole('button',{name:'Solicitar revisión'})).toBeDisabled();}
  draft('\u{1f600}'.repeat(500));expect(screen.getByText('1000/1000')).toBeVisible();expect(screen.getByRole('button',{name:'Solicitar revisión'})).toBeEnabled();
  draft('a'.repeat(1001));expect(screen.getByRole('textbox')).toHaveValue('a'.repeat(1000));
});
it.each([{status:'FUTURE',banActive:true},{status:'AVAILABLE',banActive:false},{status:'APPROVED',banActive:true},{status:'PENDING',banActive:false},{status:'REJECTED',banActive:false},{status:'AVAILABLE'},null])('fails closed for %j and refreshes explicitly',async raw=>{
  fetcher.mockResolvedValueOnce(banned()).mockResolvedValueOnce(json(raw));render(<OperationalApp firebase={{service:auth,localVerification:false}} api={new ApiClient(fetcher)}/>);act(()=>observer(user));
  await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(appeal('PENDING'));click('Actualizar estado');await screen.findByRole('heading',{name:'Revisión solicitada'});
});
it.each(['success','transient','temporary','permanent','deleted'])('approved appeal bootstrap %s honors authoritative result',async mode=>{
  fetcher.mockResolvedValueOnce(banned()).mockResolvedValueOnce(appeal('APPROVED'));
  if(mode==='success')fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({id:'p',userId:'u',status:'DRAFT'}));
  else if(mode==='transient')fetcher.mockRejectedValueOnce(new TypeError());
  else if(mode==='deleted')fetcher.mockResolvedValueOnce(json(deleted));
  else {fetcher.mockResolvedValueOnce(banned(mode==='temporary'?'ACCOUNT_TEMPORARILY_BANNED':'ACCOUNT_PERMANENTLY_BANNED'));if(mode==='permanent')fetcher.mockResolvedValueOnce(appeal('REJECTED'));}
  render(<OperationalApp firebase={{service:auth,localVerification:false}} api={new ApiClient(fetcher)}/>);act(()=>observer(user));
  if(mode==='success')await screen.findByText('Perfil confirmado: DRAFT');
  else if(mode==='transient'){
    await screen.findByRole('heading',{name:'Revisión aprobada'});expect(screen.queryByText(/Perfil confirmado/)).toBeNull();
    fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({id:'p',userId:'u',status:'DRAFT'}));click('Reintentar');await screen.findByText('Perfil confirmado: DRAFT');
  } else await screen.findByRole('heading',{name:mode==='temporary'?'Cuenta suspendida temporalmente':mode==='deleted'?'Cuenta pendiente de eliminación':'Revisión finalizada'});
  expect(fetcher.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);
});
it.each(['read','write'])('rejects late %s responses after identity/signout/tab/unmount',async operation=>{
  for(const mode of ['identity','signout','tab','unmount']) {
    const ownership=new TabOwnershipManager();vi.spyOn(ownership,'getSnapshot').mockReturnValue('active');vi.spyOn(ownership,'assert').mockImplementation(()=>{});
    const controller=new SessionController(auth,new ApiClient(fetcher).withOwnership(ownership),false,ownership);
    fetcher.mockResolvedValueOnce(banned()).mockResolvedValueOnce(appeal());const unsub=controller.subscribe(()=>{});observer(user);
    await waitFor(()=>expect(controller.snapshot.appeal?.status).toBe('AVAILABLE'));
    await expect(controller.request('/me/profile',new AbortController().signal)).rejects.toMatchObject({name:'AbortError'});
    let finish!: (r:Response)=>void;fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=operation==='read'?controller.refreshAppeal():controller.submitAppeal('Revisión');await waitFor(()=>expect(finish).toBeTypeOf('function'));
    const signal=fetcher.mock.calls.at(-1)?.[1]?.signal;
    if(mode==='identity'){fetcher.mockResolvedValueOnce(json({code:'UNAVAILABLE'},503));observer({...user,uid:'other'});}else if(mode==='signout')controller.signOut();else if(mode==='tab')ownership.stop();else unsub();
    expect(signal?.aborted).toBe(true);finish(appeal('APPROVED'));await pending;expect(controller.snapshot.phase).not.toBe('ready');expect(controller.snapshot.appeal?.status).not.toBe('APPROVED');unsub();
  }
});
it('immediately retires ready UI and concurrent requests after a domain suspension',async()=>{
  const controller=new SessionController(auth,new ApiClient(fetcher),false);fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({id:'p',userId:'u',status:'DRAFT'}));const unsub=controller.subscribe(()=>{});observer(user);await waitFor(()=>expect(controller.snapshot.phase).toBe('ready'));
  fetcher.mockResolvedValueOnce(banned()).mockResolvedValueOnce(appeal('PENDING'));
  await expect(controller.request('/me/home',new AbortController().signal)).rejects.toBeDefined();await waitFor(()=>expect(controller.snapshot.appeal?.status).toBe('PENDING'));
  expect(controller.snapshot.account).toBeNull();expect(controller.snapshot.profile).toBeNull();unsub();
});
