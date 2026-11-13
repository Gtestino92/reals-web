import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome } from '../home/contracts';
import { sessionContext } from '../visual/VisualSession';
import { parseAvailability, parseConnection, parseNegotiation, parseProposals, type Availability, type Connection, type Negotiation, type Proposal } from './contracts';
import { reviewReason, roundState, validateSlots } from './policy';

interface State { connection: Connection | null; negotiation: Negotiation | null; proposals: Proposal[]; availability: Availability | null; draft: string[]; busy: boolean; pending: boolean; verified: boolean; uncertain: boolean; error: string; message: string; errorContext: 'screen' | 'submit' | 'review'; offset: number; terminal: boolean }
const messages: Record<string,string> = {
  SCHEDULING_NOT_AVAILABLE:'La coordinación ya no está disponible.', SCHEDULING_EXPIRED:'La coordinación venció. Consultamos el estado actual.', SCHEDULING_INVALID_PROPOSALS:'Revisá los horarios elegidos.', SCHEDULING_PROPOSALS_ALREADY_SUBMITTED:'Ya enviaste horarios en esta ronda.', SCHEDULING_ROUND_CHANGED:'La ronda cambió. Revisá las opciones de la ronda actual.', SCHEDULING_PARTNER_PROPOSALS_NOT_AVAILABLE:'La lista recibida ya no está disponible.', SCHEDULING_PROPOSAL_NOT_AVAILABLE:'Este horario ya no está disponible.', SCHEDULING_CANNOT_ACCEPT_OWN_PROPOSAL:'No podés aceptar tu propio horario.', SCHEDULING_SLOT_CONFLICT:'El horario se superpone o no está disponible para confirmar. Elegí otra opción.',
};
export class SchedulingSession {
  private state: State = {connection:null,negotiation:null,proposals:[],availability:null,draft:[],busy:true,pending:false,verified:false,uncertain:false,error:'',message:'',errorContext:'screen',offset:0,terminal:false};
  private listeners = new Set<()=>void>();
  private lifetime = new AbortController();
  private gate = false;
  private generation = 0;
  readonly context: string;
  constructor(private controller: SessionController, readonly connectionId: string, readonly matchId: string, private finish: ()=>void, private lock: (pending: boolean)=>void = ()=>{}) {this.context=sessionContext(controller);}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  getSnapshot=()=>this.state;
  private current=()=>!this.lifetime.signal.aborted && this.controller.getSnapshot().phase==='ready' && sessionContext(this.controller)===this.context;
  private install(patch: Partial<State>) {if(this.current()){this.state={...this.state,...patch};if(patch.pending!==undefined)this.lock(patch.pending);this.listeners.forEach(fn=>fn());}}
  start() {if(this.lifetime.signal.aborted){this.lifetime=new AbortController();this.gate=false;this.generation++;}}
  dispose() {this.generation++;this.lifetime.abort();this.lock(false);}
  now=()=>Date.now()+this.state.offset;
  setDraft=(draft: string[])=>{if(!this.gate)this.install({draft});};
  private request=(suffix: string,method='GET',body?: unknown)=>this.controller.request(`/connections/${encodeURIComponent(this.connectionId)}${suffix}`,this.lifetime.signal,method,body);
  private async snapshot() {
    const me=this.controller.getSnapshot().account?.id;
    if(!me)throw new ApiError('invalid');
    const c=parseConnection(await this.request(''),this.connectionId,this.matchId,me);
    if(c.state==='SCHEDULING_PENDING')return {connection:c,negotiation:null,proposals:[],availability:null,offset:0};
    if(!['SCHEDULING_PHASE','SECOND_CHAT_SCHEDULED','SECOND_CHAT_AVAILABLE','SECOND_CHAT','CLOSED'].includes(c.state))throw new ApiError('invalid');
    const n=parseNegotiation(await this.request('/negotiation'),this.connectionId);
    const p=parseProposals(await this.request('/proposals'),this.connectionId,[c.userAId,c.userBId]);
    const a=parseAvailability(await this.request('/scheduling-availability'));
    const after=parseNegotiation(await this.request('/negotiation'),this.connectionId);
    const end=parseConnection(await this.request(''),this.connectionId,this.matchId,me);
    if(JSON.stringify(n)!==JSON.stringify(after)||c.updatedAt!==end.updatedAt||c.state!==end.state||p.some(v=>v.roundNumber>n.roundNumber)||n.schedulingExpiresAt!==c.schedulingExpiresAt)throw new ApiError('invalid');
    if(c.state!=='CLOSED'&&((n.status==='PENDING'&&c.state!=='SCHEDULING_PHASE')||(n.status==='CONFIRMED'&&!c.state.startsWith('SECOND_CHAT'))||(n.status==='FAILED'&&c.state!=='CLOSED')))throw new ApiError('invalid');
    return {connection:c,negotiation:n,proposals:p,availability:a,offset:Date.parse(a.serverTime)-Date.now()};
  }
  private async reconcile(home: boolean) {
    const ticket=this.generation;
    const next=await this.snapshot();
    if(home)parseHome(await this.controller.request('/me/home',this.lifetime.signal));
    if(!this.current()||ticket!==this.generation)return false;
    const changed=this.state.negotiation?.roundNumber!==next.negotiation?.roundNumber;
    this.install({...next,verified:true,uncertain:false,...(changed?{draft:[]}:{}),terminal:next.connection.state==='CLOSED'&&next.negotiation?.status!=='FAILED'});
    return true;
  }
  refresh=async()=>{
    if(this.gate||!this.current()||document.visibilityState==='hidden')return;
    const ticket=this.generation;
    this.gate=true;this.install({busy:true,verified:false});
    try {await this.reconcile(this.state.uncertain);if(this.current()&&ticket===this.generation)this.install({error:''});}
    catch(error){if(ticket===this.generation)this.failure(error);}
    finally{if(ticket===this.generation){this.gate=false;this.install({busy:false});}}
  };
  private failure(error: unknown) {
    const denied=error instanceof ApiError&&[401,403,404].includes(error.status)&&!messages[error.code];
    this.install({verified:false,availability:null,terminal:denied,error:denied?'La coordinación no está disponible para tu cuenta. Volvé a Actividad.':'No pudimos verificar el estado o la disponibilidad. Revisá tu conexión y reintentá.',errorContext:'screen'});
  }
  act=async(operation: 'submit'|'accept'|'reject'|'block',proposalId?: string)=>{
    if(this.gate||!this.current()||!this.state.verified||this.state.uncertain||this.state.terminal||document.visibilityState==='hidden')return;
    const round=this.state.negotiation?.roundNumber, draft=[...this.state.draft];
    this.gate=true;this.install({busy:true,pending:true,error:'',message:'',errorContext:operation==='submit'?'submit':operation==='block'?'screen':'review'});
    const ticket=this.generation;
    let attempted=false;
    try {
      if(!await this.reconcile(false)||ticket!==this.generation)return;
      const n=this.state.negotiation, c=this.state.connection;
      if(operation!=='block') {
        if(n?.roundNumber!==round)throw new ApiError('backend',409,'SCHEDULING_ROUND_CHANGED');
        if(!n||n.status!=='PENDING'||c?.state!=='SCHEDULING_PHASE')throw new ApiError('backend',409,'SCHEDULING_NOT_AVAILABLE');
        if(Date.parse(n.schedulingExpiresAt)<=this.now())throw new ApiError('backend',409,'SCHEDULING_EXPIRED');
        const r=roundState(false,n,this.state.proposals,this.controller.getSnapshot().account!.id);
        if(operation==='submit') {
          if(r.stage!=='WaitingForMyProposals')throw new ApiError('backend',409,'SCHEDULING_PROPOSALS_ALREADY_SUBMITTED');
          const error=validateSlots(draft,this.now(),this.state.availability);if(error){this.install({error});return;}
        }
        if(operation==='accept'&&!r.received.some(p=>p.id===proposalId&&!reviewReason(p.proposedDateTime,this.now(),this.state.availability)))throw new ApiError('backend',409,'SCHEDULING_PROPOSAL_NOT_AVAILABLE');
        if(operation==='reject'&&!r.received.length)throw new ApiError('backend',409,'SCHEDULING_PARTNER_PROPOSALS_NOT_AVAILABLE');
      }
      attempted=true;
      const result=operation==='block'?await this.controller.request(`/matches/${encodeURIComponent(this.matchId)}/block`,this.lifetime.signal,'POST'):await this.request(operation==='submit'?'/proposals':operation==='accept'?`/proposals/${encodeURIComponent(proposalId??'')}/acceptance`:'/negotiation/rejections','POST',operation==='submit'?{expectedRoundNumber:round,proposedDateTimes:draft}:operation==='reject'?{expectedRoundNumber:round}:undefined);
      if(!this.current()||ticket!==this.generation)return;
      if(operation==='block'){
        if(!object(result)||typeof result.id!=='string')throw new ApiError('invalid');
        parseHome(await this.controller.request('/me/home',this.lifetime.signal));
        if(this.current()&&ticket===this.generation){this.install({pending:false,busy:false,terminal:true});this.finish();}return;
      }
      if(operation==='submit')parseProposals(result,this.connectionId,[c!.userAId,c!.userBId]);else parseNegotiation(result,this.connectionId);
      this.install({uncertain:true,verified:false});
      await this.reconcile(true);
      const status=this.state.negotiation?.status;
      this.install({message:status==='CONFIRMED'?'Horario confirmado.':status==='FAILED'?'No hubo acuerdo.':operation==='submit'?'Enviamos tus horarios.':operation==='accept'?'Aceptamos el horario.':this.state.negotiation?.roundNumber!==round?'Ambas listas fueron rechazadas. Se abri\u00f3 una nueva ronda.':'Rechazaste las opciones recibidas.'});
    } catch(error) {
      if(!this.current()||ticket!==this.generation)return;
      const known=error instanceof ApiError&&error.kind==='backend'&&error.status>=400&&error.status<500;
      this.install({uncertain:attempted&&!known,verified:false});
      const message=known?(messages[error.code]??'No se pudo completar la acción. Revisá los requisitos de tu cuenta y volvé a consultar.'):'No pudimos confirmar el resultado. Consultamos el estado antes de permitir otra acción.';
      try {
        if(operation==='block'&&attempted){
          const home=parseHome(await this.controller.request('/me/home',this.lifetime.signal));
          if(![...home.pendingActions,...home.nextSteps].some(v=>v.matchId===this.matchId)){if(this.current()&&ticket===this.generation) {this.install({pending:false,busy:false,terminal:true});this.finish();}return;}
        }
        await this.reconcile(true);
      }catch{if(ticket===this.generation)this.install({verified:false,availability:null});}
      if(ticket===this.generation)this.install({error:message});
    } finally {if(ticket===this.generation){this.gate=false;this.install({busy:false,pending:false});}}
  };
}
