import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../auth/api';
import { SessionController } from '../auth/session';
import { VisualReview } from './VisualReview';
import { visualProfile } from './fixtures';
function setup() {
 const user = { uid:'f',emailVerified:true,getIdToken:async()=> 'test',reload:async()=>{} };
 const controller = new SessionController({ observe:()=>()=>{},signIn:async()=>user,signUp:async()=>user,google:async()=>user,verify:async()=>{},signOut:async()=>{} },new ApiClient(),false);
 controller.snapshot = {...controller.snapshot,phase:'ready',account:{id:'me',status:'ACTIVE'},profile:{id:'p',userId:'me',status:'ACTIVE'}};
 const listeners = new Set<()=>void>(); vi.spyOn(controller,'subscribe').mockImplementation(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};});
 const request = vi.spyOn(controller,'request').mockImplementation(async path=>path.endsWith('/visual-profile') ? visualProfile() : {id:path.split('/').at(-1),userAId:'me',userBId:'them',state:'VISUAL_PHASE'});
 const replace = (phase: 'ready' | 'login' = 'ready') => {controller.snapshot={...controller.snapshot,phase,authContextVersion:(controller.snapshot.authContextVersion??0)+1};listeners.forEach(fn=>fn());};
 return {controller,request,replace};
}
function deferred() {let resolve!: (v:unknown)=>void;const promise=new Promise<unknown>(r=>{resolve=r;});return {promise,resolve};}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('renders editorial order, accessible photos and no personal-message reads; handles image errors',async()=>{
 const {controller,request}=setup();const {container}=render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);
 await screen.findByRole('heading',{name:'María'});
 const content=container.querySelector('.visual-profile')!;
 expect(Array.from(content.children).map(e=>e.tagName)).toEqual(['HEADER','FIGURE','SECTION','FIGURE','SECTION','FIGURE','SECTION','FIGURE']);
 expect(screen.getAllByRole('img').map(i=>i.getAttribute('src'))).toEqual(['one','two','three','four'].map(id=>`https://media.example/${id}?sig=a%2Fb&x=1`));
 fireEvent.error(screen.getAllByRole('img')[0]!);expect(screen.getByText(/No se pudo cargar esta foto/)).toBeVisible();
 expect(request.mock.calls.map(c=>c[0])).toEqual(['/matches/m','/matches/m/visual-profile']);
});
it('shows loading, empty-photo state, omits absent sections and supports return',async()=>{
 const {controller,request}=setup(), pending=deferred(), back=vi.fn();request.mockReturnValueOnce(pending.promise);
 render(<VisualReview controller={controller} matchId="m" onBack={back}/>);expect(screen.getByText('Cargando perfil…')).toBeVisible();
 request.mockResolvedValueOnce(visualProfile({photos:[],bio:null,affinityIndicators:[],profileQuestions:[]}));
 await act(async()=>pending.resolve({id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'}));
 expect(await screen.findByText('No hay fotos aprobadas disponibles.')).toBeVisible();expect(screen.queryByText('Bio')).toBeNull();expect(screen.queryByText('Afinidades compartidas')).toBeNull();expect(screen.queryByText('Preguntas del perfil')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Volver a Actividad'}));expect(back).toHaveBeenCalledOnce();
});
it.each([new ApiError('backend',409,'VISUAL_CONTENT_NOT_AVAILABLE'),new ApiError('backend',409,'VISUAL_REVIEW_EXPIRED'),new ApiError('authorization',403),new ApiError('authorization',401)])('clears partner data on terminal refresh failure',async error=>{
 const {controller,request}=setup();render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);await screen.findByText('María');request.mockRejectedValueOnce(error);
 fireEvent.click(screen.getByRole('button',{name:'Actualizar perfil'}));await screen.findByRole('alert');expect(screen.queryByText('María')).toBeNull();expect(screen.queryByRole('img')).toBeNull();expect(screen.queryByRole('button',{name:'Reintentar'})).toBeNull();
});
it('clears content on transient failure and recovers only via a fresh load',async()=>{
 const {controller,request}=setup();render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);await screen.findByText('María');request.mockRejectedValueOnce(new ApiError('network'));fireEvent.click(screen.getByRole('button',{name:'Actualizar perfil'}));await screen.findByRole('alert');expect(screen.queryByText('María')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByText('María');
});
it('does not request a visual profile for a changed match',async()=>{
 const {controller,request}=setup();request.mockResolvedValueOnce({id:'m',userAId:'me',userBId:'them',state:'EXPIRED'});render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);await screen.findByRole('alert');expect(request).toHaveBeenCalledTimes(1);
});
it.each(['login','ready'] as const)('rejects obsolete profile responses after session transition to %s',async phase=>{
 const {controller,request,replace}=setup(),pending=deferred();request.mockImplementation(async path=>path.endsWith('/visual-profile')?pending.promise:{id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});
 render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
 request.mockRejectedValue(new ApiError('network'));act(()=>replace(phase));await act(async()=>pending.resolve(visualProfile()));expect(screen.queryByText('María')).toBeNull();
});
it('aborts leaving a match and ignores its late response after navigation',async()=>{
 const {controller,request}=setup(),pending=deferred();request.mockImplementation(async path=>path==='/matches/old/visual-profile'?pending.promise:path.endsWith('/visual-profile')?visualProfile({displayName:'Nueva'}):{id:path.split('/').at(-1),userAId:'me',userBId:'them',state:'VISUAL_PHASE'});
 const view=render(<VisualReview controller={controller} matchId="old" onBack={()=>{}}/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));const signal=request.mock.calls[1]![1];view.rerender(<VisualReview controller={controller} matchId="new" onBack={()=>{}}/>);await screen.findByText('Nueva');expect(signal.aborted).toBe(true);await act(async()=>pending.resolve(visualProfile()));expect(screen.queryByText('María')).toBeNull();
});
it('revalidates at advisory deadline without locally declaring expiration',async()=>{
 vi.useFakeTimers();const {controller,request}=setup();request.mockImplementation(async path=>path.endsWith('/visual-profile')?visualProfile({visualExpiresAt:new Date(Date.now()+1000).toISOString()}):{id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});
 render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);await act(async()=>{});expect(screen.getByText('María')).toBeVisible();request.mockRejectedValueOnce(new ApiError('backend',409,'VISUAL_CONTENT_NOT_AVAILABLE'));await act(async()=>vi.advanceTimersByTime(1000));expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByText('María')).toBeNull();
});
it('aborts background reads and foreground refresh supersedes them',async()=>{
 const {controller,request}=setup(),pending=deferred();request.mockReturnValueOnce(pending.promise);render(<VisualReview controller={controller} matchId="m" onBack={()=>{}}/>);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(request.mock.calls[0]![1].aborted).toBe(true);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')));await screen.findByText('María');await act(async()=>pending.resolve({id:'bad'}));expect(screen.queryByRole('alert')).toBeNull();
});
