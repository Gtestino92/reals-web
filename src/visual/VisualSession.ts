import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome } from '../home/contracts';
import { parseVisualProfile, type VisualProfile } from './contracts';

export function normalizeMessage(value: string) {
  return value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').split('\n').map(line => line.replace(/[ \t]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,280);
}
export const validMessage = (value: string) => !!normalizeMessage(value) && !/<\s*\/?\s*[a-zA-Z][^>]*>/.test(normalizeMessage(value));
export function sessionContext(c: SessionController) { const s = c.getSnapshot(); return `${s.phase}/${s.account?.id}/${s.profile?.id}/${s.authContextVersion}`; }
type Operation = 'read' | 'save' | 'APPROVED' | 'REJECTED' | 'block';
interface State { imageRetry: number; profile: VisualProfile | null; busy: boolean; concealed: boolean; error: string; terminal: boolean; pending: Operation | null; message: string | null; messageLoaded: boolean; messageError: boolean; uncertain: boolean; notice: string }
export class VisualSession {
  private state: State = { imageRetry:0,profile:null,busy:true,concealed:false,error:'',terminal:false,pending:null,message:null,messageLoaded:false,messageError:false,uncertain:false,notice:'' };
  private listeners = new Set<()=>void>();
  private lifetime = new AbortController();
  private read: AbortController | null = null;
  private writing = false;
  private serial = 0;
  private reconcile: Operation | null = null;
  private autoMessageAttempted = false;
  readonly context: string;
  constructor(private controller: SessionController, readonly matchId: string, private finish: () => void) { this.context=sessionContext(controller); }
  subscribe = (fn:()=>void) => { this.listeners.add(fn);return()=>{this.listeners.delete(fn);}; };
  getSnapshot = () => this.state;
  private current() { return !this.lifetime.signal.aborted && sessionContext(this.controller)===this.context && this.controller.getSnapshot().phase==='ready'; }
  private install(patch: Partial<State>) { if(this.current()){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());} }
  start() { if(this.lifetime.signal.aborted) { this.lifetime=new AbortController(); this.read=null; this.writing=false; this.serial++; } }
  dispose() {this.serial++;this.lifetime.abort();this.read?.abort();}
  private end() {this.install({profile:null,message:null,terminal:true,pending:null,busy:false});this.finish();}
  private denied(error: unknown) { return error instanceof ApiError && ([401,403,404].includes(error.status) || ['VISUAL_CONTENT_NOT_AVAILABLE','VISUAL_REVIEW_EXPIRED'].includes(error.code)); }
  private request(path: string, signal: AbortSignal, method='GET', body?: unknown) {return this.controller.request(`/matches/${encodeURIComponent(this.matchId)}${path}`,signal,method,body);}
  conceal = () => {if(!this.writing){this.read?.abort();this.read=null;this.serial++;}this.install({concealed:true});};
  resume = () => {
    const expiry=this.state.profile?.visualExpiresAt;
    // Same-session snapshot may remain visible during ordinary revalidation,
    // just as during polling. Locally expired content waits for authority.
    if(this.current() && this.state.profile && (!expiry || Date.parse(expiry)>Date.now())) this.install({concealed:false});
    return this.refresh();
  };
  refresh = async (retryImages = false) => {
    if(!this.current()||document.visibilityState!=='visible'||this.writing||this.read||this.state.terminal) return;
    const read=new AbortController(), ticket=++this.serial;this.read=read;
    const signal=AbortSignal.any([read.signal,this.lifetime.signal]);
    const current=()=>this.current()&&ticket===this.serial&&!signal.aborted;
    this.install({busy:true,error:''});
    let autoRead=false;
    try {
      const match=await this.request('',signal);
      if(!current())return;
      const me=this.controller.getSnapshot().account?.id;
      if(!object(match)||match.id!==this.matchId||(match.userAId!==me&&match.userBId!==me))throw new ApiError('invalid');
      if(match.state!=='VISUAL_PHASE'){this.end();return;}
      let profile=parseVisualProfile(await this.request('/visual-profile',signal));
      if(!current())return;
      if(!profile.visualExpiresAt && typeof match.visualExpiresAt==='string' && Number.isFinite(Date.parse(match.visualExpiresAt)))profile={...profile,visualExpiresAt:match.visualExpiresAt};
      if(this.reconcile==='APPROVED'||this.reconcile==='REJECTED'||this.reconcile==='block') {
        const home=parseHome(await this.controller.request('/me/home',signal));
        if(!current())return;
        if(!home.pendingActions.some(a=>a.type==='VISUAL_REVIEW'&&a.matchId===this.matchId)){this.end();return;}

      }
      this.reconcile=null;
      autoRead=profile.partnerPersonalMessageSubmitted&&profile.partnerPersonalMessageRead&&!this.state.messageLoaded&&!this.autoMessageAttempted;
      this.install({imageRetry:this.state.imageRetry+(retryImages?1:0),profile,busy:false,concealed:false,uncertain:false,error:'',...(!profile.partnerPersonalMessageSubmitted?{message:null,messageLoaded:false}: {})});
    } catch(error) {
      if(current())this.install({profile:null,message:null,messageLoaded:false,busy:false,concealed:false,terminal:this.denied(error),error:this.denied(error)?'El contenido visual ya no está disponible. Volvé a Actividad.':'No pudimos actualizar el descubrimiento. Revisá tu conexión y usá Reintentar.'});
    } finally { if(ticket===this.serial)this.read=null; }
    if(autoRead&&current()){this.autoMessageAttempted=true;void this.act('read');}
  };
  act = async (operation: Operation, draft='') => {
    const p=this.state.profile;
    if(!this.current()||this.writing||this.read||this.state.terminal||this.state.uncertain||!p||this.state.concealed|| (p.visualExpiresAt&&Date.parse(p.visualExpiresAt)<=Date.now()))return;
    if(operation==='save'&&(p.myPersonalMessageSubmitted||!validMessage(draft)))return;
    if(operation==='read'&&(!p.partnerPersonalMessageSubmitted||this.state.messageLoaded))return;
    this.writing=true;this.install({pending:operation,error:'',messageError:false,notice:''});
    const lifetime=this.lifetime, signal=lifetime.signal;
    const current=()=>this.current()&&this.lifetime===lifetime&&!signal.aborted;
    let reconcile=false;
    try {
      const result=await this.request(operation==='read'?'/personal-messages/partner':operation==='save'?'/personal-messages/me':operation==='block'?'/block':'/visual-decision',signal,operation==='read'?'GET':operation==='save'?'PUT':'POST',operation==='save'?{message:normalizeMessage(draft)}:operation==='APPROVED'||operation==='REJECTED'?{decision:operation}:undefined);
      if(!current())return;
      if(operation==='read') {
        if(!object(result)||!(result.message===null||typeof result.message==='string'))throw new ApiError('invalid');
        this.install({message:result.message,messageLoaded:true,profile:{...p,partnerPersonalMessageRead:true,decisionRequiresPartnerPersonalMessageRead:false}});
      } else if(operation==='save') {if(result!==undefined)throw new ApiError('invalid');this.install({profile:{...p,myPersonalMessageSubmitted:true},notice:'Guardamos tu mensaje personal.'});reconcile=true;}
      else {
        if(!object(result)||typeof result.id!=='string'||(operation!=='block'&&(result.id!==this.matchId||!['VISUAL_PHASE','VISUAL_APPROVED','VISUAL_REJECTED','EXPIRED'].includes(String(result.state)))))throw new ApiError('invalid');
        this.end();
      }
    } catch(error) {
      if(!current())return;
      if(this.denied(error)){this.install({profile:null,message:null,messageLoaded:false,terminal:true,error:'El contenido visual ya no está disponible. Volvé a Actividad.'});}
      else if(operation==='read')this.install({messageError:true});
      else if(error instanceof ApiError && error.kind==='backend' && error.status>=400 && error.status<500 && error.status!==409) { this.install({error:'No se pudo completar la acción. Revisá los requisitos de tu cuenta o intentá más tarde.'}); }
      else {
        this.reconcile=operation;reconcile=true;
        this.install({uncertain:true,error:'No pudimos confirmar el resultado. Consultá el estado antes de volver a intentar.'});
      }
    } finally {if(current()){this.writing=false;this.install({pending:null});}}
    if((reconcile||this.state.concealed)&&current()&&document.visibilityState==='visible')void this.refresh();
  };
}
