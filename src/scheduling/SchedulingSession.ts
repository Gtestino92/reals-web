import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome, type Activity as HomeActivity, type HomeData } from '../home/contracts';
import { sessionContext } from '../visual/VisualSession';
import { parseAvailability, parseConnection, parseNegotiation, parseProposals, type Availability, type Connection, type Negotiation, type Proposal } from './contracts';
import { reviewReason, roundState, validateSlots } from './policy';

type Activity = 'loading' | 'idle' | 'polling' | 'refreshing' | 'mutating' | 'reconciling';
interface State { activity: Activity; connection: Connection | null; negotiation: Negotiation | null; proposals: Proposal[]; availability: Availability | null; calendarActivity: HomeActivity | null; calendarReadFailed: boolean; draft: string[]; busy: boolean; pending: boolean; verified: boolean; uncertain: boolean; error: string; message: string; errorContext: 'screen' | 'submit' | 'review'; offset: number; terminal: boolean }
const accessDenied = (error: unknown) => error instanceof ApiError && [401,403,404].includes(error.status) && !messages[error.code];
const messages: Record<string,string> = {
  SCHEDULING_NOT_AVAILABLE:'La coordinación ya no está disponible.', SCHEDULING_EXPIRED:'La coordinación venció. Consultamos el estado actual.', SCHEDULING_INVALID_PROPOSALS:'Revisá los horarios elegidos.', SCHEDULING_PROPOSALS_ALREADY_SUBMITTED:'Ya enviaste horarios en esta ronda.', SCHEDULING_ROUND_CHANGED:'La ronda cambió. Revisá las opciones de la ronda actual.', SCHEDULING_PARTNER_PROPOSALS_NOT_AVAILABLE:'La lista recibida ya no está disponible.', SCHEDULING_PROPOSAL_NOT_AVAILABLE:'Este horario ya no está disponible.', SCHEDULING_CANNOT_ACCEPT_OWN_PROPOSAL:'No podés aceptar tu propio horario.', SCHEDULING_SLOT_CONFLICT:'El horario se superpone o no está disponible para confirmar. Elegí otra opción.',
};
export type SchedulingHomeRead = { home: HomeData; startedAt: number; serverTime: number };
export class SchedulingSession {
  private state: State = {activity:'loading',connection:null,negotiation:null,proposals:[],availability:null,calendarActivity:null,calendarReadFailed:false,draft:[],busy:true,pending:false,verified:false,uncertain:false,error:'',message:'',errorContext:'screen',offset:0,terminal:false};
  private listeners = new Set<()=>void>();
  private lifetime = new AbortController();
  private gate = false;
  private background: { controller: AbortController; calendar: boolean } | null = null;
  private generation = 0;
  readonly context: string;
  constructor(private controller: SessionController, readonly connectionId: string, readonly matchId: string, private finish: ()=>void, private lock: (pending: boolean)=>void = ()=>{}, private observeHome?: (read: SchedulingHomeRead) => void) {this.context=sessionContext(controller);}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  getSnapshot=()=>this.state;
  private current=()=>!this.lifetime.signal.aborted && this.controller.getSnapshot().phase==='ready' && sessionContext(this.controller)===this.context;
  private install(patch: Partial<State>) {if(this.current()){this.state={...this.state,...patch};if(patch.pending!==undefined)this.lock(patch.pending);this.listeners.forEach(fn=>fn());}}
  start() {if(this.lifetime.signal.aborted){this.lifetime=new AbortController();this.gate=false;this.generation++;}}
  dispose() {this.generation++;this.background?.controller.abort();this.background=null;this.lifetime.abort();this.lock(false);}
  now=()=>Date.now()+this.state.offset;
  setDraft=(draft: string[])=>{if(!this.gate||this.state.activity==='polling')this.install({draft});};
  private request=(suffix: string,method='GET',body?: unknown)=>this.controller.request(`/connections/${encodeURIComponent(this.connectionId)}${suffix}`,this.lifetime.signal,method,body);
  private async snapshot(signal: AbortSignal) {
    // Capture this read's signal; obsolete continuations cannot start more GETs.
    const read = async (suffix: string) => {
      signal.throwIfAborted();
      const result = await this.controller.request(`/connections/${encodeURIComponent(this.connectionId)}${suffix}`,signal);
      signal.throwIfAborted();
      return result;
    };
    const me=this.controller.getSnapshot().account?.id;
    if(!me)throw new ApiError('invalid');
    const c=parseConnection(await read(''),this.connectionId,this.matchId,me);
    if(c.state==='SCHEDULING_PENDING')return {connection:c,negotiation:null,proposals:[],availability:null,offset:0};
    if(!['SCHEDULING_PHASE','SECOND_CHAT_SCHEDULED','SECOND_CHAT_AVAILABLE','SECOND_CHAT','CLOSED'].includes(c.state))throw new ApiError('invalid');
    const n=parseNegotiation(await read('/negotiation'),this.connectionId);
    // Independent reads share a phase, still bracketed by both authority checks.
    const [rawProposals,rawAvailability]=await Promise.all([read('/proposals'),read('/scheduling-availability')]);
    const p=parseProposals(rawProposals,this.connectionId,[c.userAId,c.userBId]),a=parseAvailability(rawAvailability);
    const [rawAfter,rawEnd]=await Promise.all([read('/negotiation'),read('')]);
    const after=parseNegotiation(rawAfter,this.connectionId),end=parseConnection(rawEnd,this.connectionId,this.matchId,me);
    if(JSON.stringify(n)!==JSON.stringify(after)||c.updatedAt!==end.updatedAt||c.state!==end.state||p.some(v=>v.roundNumber>n.roundNumber)||n.schedulingExpiresAt!==c.schedulingExpiresAt)throw new ApiError('invalid');
    if(c.state!=='CLOSED'&&((n.status==='PENDING'&&c.state!=='SCHEDULING_PHASE')||(n.status==='CONFIRMED'&&!c.state.startsWith('SECOND_CHAT'))||(n.status==='FAILED'&&c.state!=='CLOSED')))throw new ApiError('invalid');
    return {connection:c,negotiation:n,proposals:p,availability:a,offset:Date.parse(a.serverTime)-Date.now()};
  }
  private async reconcile(home: 'required' | 'upcoming' | 'skip', signal = this.lifetime.signal) {
    const ticket=this.generation;
    const ownsRead=()=>!signal.aborted&&this.current()&&ticket===this.generation;
    const next=await this.snapshot(signal);
    if(!ownsRead())return false;
    const confirmedAt = next.negotiation?.status === 'CONFIRMED' ? next.negotiation.confirmedDateTime : null;
    const upcoming = next.connection.state === 'SECOND_CHAT_SCHEDULED' && !!confirmedAt &&
      Date.parse(confirmedAt) > Date.now() + next.offset;
    let calendarActivity: HomeActivity | null = null;
    let calendarReadFailed = false;
    let validatedHome: SchedulingHomeRead | undefined;
    if (home === 'required' || (home === 'upcoming' && upcoming)) {
      try {
        const startedAt = Date.now();
        const projection = parseHome(await this.controller.request('/me/home', signal));
        if (this.observeHome) validatedHome = { home: projection, startedAt, serverTime: startedAt + next.offset };
        if (upcoming) {
          const matches = projection.nextSteps.filter(item => item.connectionId === this.connectionId && item.matchId === this.matchId);
          const item = matches[0];
          if (matches.length === 1 && item?.type === 'SECOND_CHAT_SCHEDULED' && item.secondChat &&
            Date.parse(item.secondChat.availableAt) === Date.parse(confirmedAt)) calendarActivity = item;
        }
      } catch (error) {
        if (home === 'required' || accessDenied(error)) throw error;
        calendarReadFailed = true;
      }
    }
    if(!ownsRead())return false;
    // A scheduled connection can close. An older pending snapshot cannot
    // reopen its negotiation or restore a proposal message.
    if (this.state.negotiation?.status==='CONFIRMED' && next.connection.state!=='CLOSED' && next.negotiation?.status!=='CONFIRMED') {
      this.install({calendarActivity:null,calendarReadFailed:false});
      return false;
    }
    const changed=this.state.negotiation?.roundNumber!==next.negotiation?.roundNumber;
    if (validatedHome) this.observeHome?.(validatedHome);
    this.install({...next,calendarActivity,calendarReadFailed,verified:true,uncertain:false,...(changed?{draft:[]}:{}),...(next.negotiation?.status==='CONFIRMED'?{message:''}:{}),terminal:next.connection.state==='CLOSED'&&next.negotiation?.status!=='FAILED'});
    return true;
  }
  canPollCalendar(now = this.now()) {
    const { connection, negotiation, terminal, uncertain } = this.state;
    return !terminal && !uncertain && connection?.state === 'SECOND_CHAT_SCHEDULED' &&
      negotiation?.status === 'CONFIRMED' && !!negotiation.confirmedDateTime && Date.parse(negotiation.confirmedDateTime) > now;
  }
  private async reconcileConfirmedConnection(signal: AbortSignal) {
    const before = this.state.connection;
    const me = this.controller.getSnapshot().account?.id;
    if (!before || !me) throw new ApiError('invalid');
    const ticket = this.generation;
    const raw = await this.controller.request(`/connections/${encodeURIComponent(this.connectionId)}`, signal);
    if (signal.aborted || !this.current() || ticket !== this.generation || !this.canPollCalendar()) return false;
    const connection = parseConnection(raw, this.connectionId, this.matchId, me);
    if (connection.userAId !== before.userAId || connection.userBId !== before.userBId) throw new ApiError('invalid');
    if (connection.state === 'CLOSED' || connection.state === 'SECOND_CHAT_AVAILABLE' || connection.state === 'SECOND_CHAT') {
      this.install({ connection, terminal:connection.state === 'CLOSED', calendarActivity:null, calendarReadFailed:false });
      return true;
    }
    if (connection.state !== 'SECOND_CHAT_SCHEDULED') throw new ApiError('invalid');
    // A changed scheduled record needs the same cross-checks as the initial confirmation.
    return connection.updatedAt === before.updatedAt && connection.schedulingExpiresAt === before.schedulingExpiresAt
      ? true : this.reconcile('upcoming', signal);
  }
  // Only healthy background reads are preemptible. Recovery of an uncertain
  // write retains the blocking reconciliation gate and cannot be bypassed.
  poll=()=>this.refresh(true);
  tick=()=>{
    if (this.state.terminal) return;
    if (!this.state.negotiation || this.state.negotiation.status === 'PENDING') return this.poll();
    if (this.canPollCalendar()) return this.read('calendar');
  };
  pause=()=>{if(this.background){this.cancelBackground();this.install({activity:'idle'});}};
  stopCalendarPoll=()=>{if(this.background?.calendar)this.pause();};
  refresh=(background = false)=>this.read(background?'background':'refresh');
  private async read(mode: 'refresh' | 'background' | 'calendar') {
    if(this.gate||!this.current()||document.visibilityState==='hidden')return;
    const calendarPoll=mode==='calendar';
    const silent=calendarPoll||(mode==='background'&&this.state.verified&&!this.state.uncertain);
    const owned=silent?new AbortController():null;
    this.background=owned?{controller:owned,calendar:calendarPoll}:null;
    const signal=owned?AbortSignal.any([this.lifetime.signal,owned.signal]):this.lifetime.signal;
    const ticket=this.generation;
    const wasVerified=this.state.verified;
    this.gate=true;
    this.install(silent?{activity:'polling'}:{activity:this.state.uncertain?'reconciling':this.state.connection?'refreshing':'loading',busy:true,verified:false});
    try {
      const installed=await (calendarPoll&&wasVerified
        ? this.reconcileConfirmedConnection(signal)
        : this.reconcile(this.state.uncertain?'required':'upcoming',signal));
      if(this.current()&&ticket===this.generation&&(!silent||!wasVerified))this.install(installed?{error:''}:{verified:wasVerified});
    } catch(error) {
      if(ticket===this.generation&&!signal.aborted&&(!calendarPoll||this.canPollCalendar()))this.failure(error);
    } finally {
      if(ticket===this.generation){owned?.abort();this.background=null;this.gate=false;this.install({activity:'idle',busy:false});}
    }
  }
  private cancelBackground() {
    if(!this.background)return;
    this.generation++;
    this.background.controller.abort();
    this.background=null;
    this.gate=false;
  }
  private failure(error: unknown) {
    const denied=accessDenied(error);
    this.install({verified:false,availability:null,calendarActivity:null,calendarReadFailed:false,terminal:denied,error:denied?'La coordinación no está disponible para tu cuenta. Volvé a Actividad.':'No pudimos verificar el estado o la disponibilidad. Revisá tu conexión y reintentá.',errorContext:'screen'});
  }
  act=async(operation: 'submit'|'accept'|'reject'|'block',proposalId?: string)=>{
    if((this.gate&&!this.background)||!this.current()||!this.state.verified||this.state.uncertain||this.state.terminal||document.visibilityState==='hidden')return;
    this.cancelBackground();
    const round=this.state.negotiation?.roundNumber, draft=[...this.state.draft];
    this.gate=true;this.install({activity:'mutating',busy:true,pending:true,error:'',message:'',errorContext:operation==='submit'?'submit':operation==='block'?'screen':'review'});
    const ticket=this.generation;
    let attempted=false;
    try {
      if(!await this.reconcile('skip')||ticket!==this.generation)return;
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
      this.install({activity:'reconciling',uncertain:true,verified:false});
      if(!await this.reconcile('required')||ticket!==this.generation)return;
      const status=this.state.negotiation?.status;
      this.install({message:status==='CONFIRMED'?'':status==='FAILED'?'No hubo acuerdo.':operation==='submit'?'Enviamos tus horarios.':operation==='accept'?'Aceptamos el horario.':this.state.negotiation?.roundNumber!==round?'Ambas listas fueron rechazadas. Se abri\u00f3 una nueva ronda.':'Rechazaste las opciones recibidas.'});
    } catch(error) {
      if(!this.current()||ticket!==this.generation)return;
      const known=error instanceof ApiError&&error.kind==='backend'&&error.status>=400&&error.status<500;
      this.install({activity:'reconciling',uncertain:attempted&&!known,verified:false});
      const message=known?(messages[error.code]??'No se pudo completar la acción. Revisá los requisitos de tu cuenta y volvé a consultar.'):'No pudimos confirmar el resultado. Consultamos el estado antes de permitir otra acción.';
      try {
        if(operation==='block'&&attempted){
          const home=parseHome(await this.controller.request('/me/home',this.lifetime.signal));
          if(![...home.pendingActions,...home.nextSteps].some(v=>v.matchId===this.matchId)){if(this.current()&&ticket===this.generation) {this.install({pending:false,busy:false,terminal:true});this.finish();}return;}
        }
        await this.reconcile('required');
      }catch{if(ticket===this.generation)this.install({verified:false,availability:null});}
      if(ticket===this.generation)this.install({error:message});
    } finally {if(ticket===this.generation){this.gate=false;this.install({activity:'idle',busy:false,pending:false});}}
  };
}
