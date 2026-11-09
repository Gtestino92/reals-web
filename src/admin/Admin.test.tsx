import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, OperationalApp } from '../App';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { TabOwnershipManager } from '../tabs/TabOwnershipManager';
import { diag, photo, summary, appeal } from './fixtures';
let observer: (user: Identity | null) => void;
const user: Identity = { uid: 'admin', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
let allowed: boolean, photos: unknown[], writes: {path:string;body:unknown}[], fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown,status=200) => new Response(JSON.stringify(body),{status});
const owners: TabOwnershipManager[] = [];
function mount(ownership?: TabOwnershipManager, authenticated = true) {
  const service: AuthService = { observe: next => { observer=next; queueMicrotask(()=>next(authenticated ? user : null)); return () => {}; }, signOut: async () => { observer(null); }, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {} };
  const Component = ownership ? App : OperationalApp;
  return render(<Component firebase={{service,localVerification:false}} api={new ApiClient(fetcher)} {...(ownership ? {ownership} : {})} />);
}
beforeEach(() => {
  window.history.replaceState(null,'','/admin'); allowed=true; photos=[photo]; writes=[];
  fetcher=vi.fn(async (input,options) => {
    const path=String(input);
    if(path==='/api/me')return json({id: 'u',status:'ACTIVE'});
    if(path==='/api/me/profile')return json({id:'p',userId:'u',status:'DRAFT'});
    if(path.startsWith('/api/admin/')&&!allowed)return json({code:'ACCESS_DENIED'},403);
    if(options?.method==='POST'){writes.push({path,body:JSON.parse(String(options.body))});photos=[];return json({...photo,moderationStatus:'APPROVED'});}
    if(path==='/api/admin/diagnostics/matchmaking')return json(diag);
    if(path==='/api/admin/profile-photos/review')return json(photos);
    if(path==='/api/admin/penalty-appeals/pending')return json([appeal]);
    if(path==='/api/admin/safety-reports/pending'||path.startsWith('/api/admin/safety-reports?'))return json([summary]);
    if(path==='/api/admin/safety-reports/report')return json({report:summary,details:'<img src=x onerror=alert(1)> https://untrusted.invalid',verdictNotes:null,evidence:{id:'e',messageCount:1},messages:[{id:'msg',content:'<script>bad</script>',audio:{url:'https://example.invalid/audio',durationMillis:1000}}],penalty:null});
    return json({code:'NOT_FOUND'},404);
  });
});
afterEach(()=>{owners.splice(0).forEach(o=>o.stop());window.history.replaceState(null,'','/');vi.unstubAllGlobals();});
it('normal user has neutral denial and never loads lists',async()=>{allowed=false;mount();await screen.findByText('Acceso no disponible para esta sesión.');expect(fetcher.mock.calls.filter(([p])=>String(p).includes('/admin/')).map(([p])=>p)).toEqual(['/api/admin/diagnostics/matchmaking']);expect(screen.queryByText('Lucía')).toBeNull();});
it('unauthenticated direct route cannot query admin',async()=>{mount(undefined,false);await screen.findByRole('button',{name:'Ingresar'});expect(fetcher.mock.calls.some(([p])=>String(p).includes('/admin/'))).toBe(false);});
it('paginates 20 photos and handles empty queue after exact-version approval',async()=>{photos=Array.from({length:21},(_,i)=>({...photo,photoId:'p'+i,displayName:'Foto '+i}));mount();await screen.findByRole('button',{name:/Foto 0/});expect(screen.queryByRole('button',{name:/Foto 20/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Siguiente'}));fireEvent.click(screen.getByRole('button',{name:/Foto 20/}));fireEvent.click(screen.getByRole('button',{name:'Aprobar fotografía'}));expect(writes).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Confirmar decisión'}));await screen.findByText('No hay elementos.');expect(writes[0]?.body).toEqual({decision:'APPROVED',expectedPhotoVersion:42,notes:null});});
it('renders evidence as text, never hyperlinks, and audio is opt-in',async()=>{mount();await screen.findByText('Lucía');fireEvent.click(screen.getByRole('button',{name:'Reportes'}));fireEvent.click(await screen.findByRole('button',{name:/Prioritario/}));await screen.findByText('<script>bad</script>');expect(document.querySelector('a[href="https://untrusted.invalid"]')).toBeNull();expect(document.querySelector('audio')).toBeNull();expect(screen.getByRole('button',{name:'Habilitar audio'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Desestimar por abusivo o injustificado'}));expect(screen.getByRole('dialog')).toHaveTextContent('confiabilidad del denunciante');fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));});
it('appeal requires notes and links source report without storing IDs in history',async()=>{mount();await screen.findByText('Lucía');fireEvent.click(screen.getByRole('button',{name:'Apelaciones'}));fireEvent.click(await screen.findByRole('button',{name:'penalty'}));fireEvent.click(screen.getByRole('button',{name:'Aprobar apelación'}));expect(screen.getByRole('alert')).toHaveTextContent('notas válidas');expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Ver reporte de origen'}));await screen.findByText('<script>bad</script>');expect(location.pathname).toBe('/admin');expect(history.state).toBeNull();});
it('identity replacement clears existing data before second authorization',async()=>{mount();await screen.findByText('Lucía');allowed=false;act(()=>observer({...user,uid:'ordinary'}));await screen.findByText('Acceso no disponible para esta sesión.');expect(screen.queryByText('Lucía')).toBeNull();});
it('logout clears data and late reads cannot reinstall it',async()=>{mount();await screen.findByText('Lucía');let finish:(r:Response)=>void=()=>{};fetcher.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));act(()=>observer(null));await screen.findByRole('button',{name:'Ingresar'});await act(async()=>finish(json([photo])));expect(screen.queryByText('Lucía')).toBeNull();});
it('Back disposes a pending request and clears private data',async()=>{mount();await screen.findByText('Lucía');let signal:AbortSignal|null|undefined;fetcher.mockImplementationOnce((_p,o)=>{signal=o?.signal;return new Promise(()=>{});});fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));await waitFor(()=>expect(signal).toBeDefined());act(()=>{history.replaceState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));});await waitFor(()=>expect(signal?.aborted).toBe(true));expect(screen.queryByRole('heading',{name:'Reals Admin'})).toBeNull();});
it('admin requests forbid persistent cache, redirects and token mutation replay',async()=>{mount();await screen.findByText('Lucía');const options=fetcher.mock.calls.find(([p])=>String(p).includes('/admin/'))?.[1];expect(options).toMatchObject({cache:'no-store',redirect:'error',credentials:'omit'});fetcher.mockResolvedValueOnce(json({code:'INVALID_TOKEN'},401));fireEvent.click(screen.getByRole('button',{name:/Lucía/}));fireEvent.click(screen.getByRole('button',{name:'Rechazar fotografía'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar decisión'}));await screen.findByText('Tu sesión necesita renovarse. Volvé a iniciar sesión.');expect(screen.queryByText('Lucía')).toBeNull();expect(fetcher.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);});
it('never writes admin responses to persistent browser stores',async()=>{const set=vi.spyOn(Storage.prototype,'setItem');mount();await screen.findByText('Lucía');expect(set).not.toHaveBeenCalled();set.mockRestore();});

it('ownership revocation aborts pending request and removes admin data',async()=>{
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('BroadcastChannel',class { postMessage() {} close() {} });
 const previous=Object.getOwnPropertyDescriptor(navigator,'locks');
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_n:string,_o:LockOptions,callback:()=>Promise<void>)=>callback()}});
 const owner=new TabOwnershipManager();owners.push(owner);owner.start();
 const view=mount(owner);await screen.findByText('Luc\u00eda');
 let signal:AbortSignal|null|undefined;fetcher.mockImplementationOnce((_p,o)=>{signal=o?.signal;return new Promise(()=>{});});
 fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));await waitFor(()=>expect(signal).toBeDefined());
 act(()=>owner.stop());await waitFor(()=>expect(signal?.aborted).toBe(true));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'Reals Admin'})).toBeNull());
 view.unmount();expect(screen.queryByText('Luc\u00eda')).toBeNull();
 if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks');
});
