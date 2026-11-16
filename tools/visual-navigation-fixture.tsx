import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from '../src/home/Home';
import { ApiClient } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import type { Identity } from '../src/auth/firebase';
import { TabGate } from '../src/tabs/TabGate';
import { TabOwnershipManager } from '../src/tabs/TabOwnershipManager';
import { VisualSession } from '../src/visual/VisualSession';
import { SchedulingSession } from '../src/scheduling/SchedulingSession';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/auth/login.css';
const probe={sessions:0,disposed:0,schedulingSessions:0,schedulingDisposals:0,conceals:0,resumes:0,hiddenContent:0,profileMounts:0,profileRemovals:0,imageLoads:0,blankFrames:0,owner:'',authContextVersion:0,transitions:[] as string[],requests:[] as string[],writes:[] as string[]};
const schedulingSessions=new WeakSet<SchedulingSession>(), schedulingStart=SchedulingSession.prototype.start,schedulingDispose=SchedulingSession.prototype.dispose;
SchedulingSession.prototype.start=function(){if(!schedulingSessions.has(this)){schedulingSessions.add(this);probe.schedulingSessions++;}schedulingStart.call(this);};
SchedulingSession.prototype.dispose=function(){probe.schedulingDisposals++;schedulingDispose.call(this);};
const sessions=new WeakSet<VisualSession>();
const originalStart=VisualSession.prototype.start,originalDispose=VisualSession.prototype.dispose;
VisualSession.prototype.start=function(){if(!sessions.has(this)){sessions.add(this);probe.sessions++;const conceal=this.conceal,resume=this.resume;this.conceal=()=>{probe.conceals++;conceal();probe.transitions.push(`conceal:${this.getSnapshot().concealed}`);};this.resume=()=>{probe.resumes++;const r=resume();probe.transitions.push(`resume:${this.getSnapshot().concealed}`);return r;};}originalStart.call(this);};
VisualSession.prototype.dispose=function(){probe.disposed++;originalDispose.call(this);};
let observer:(user:Identity|null)=>void=()=>{},uid='fixture',homeFailure=false,profileMode='ok',delay=0,writeDelay=0,signature=0,decided=false,saved=false,remaining='none',expired=false;
const releases=new Set<()=>void>();
const identity=():Identity=>({uid,emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const expiry=()=>new Date(Date.now()+(expired?-1000:3600000)).toISOString();
const schedulingFlow=new URLSearchParams(location.search).get('flow')==='scheduling',stamp=new Date().toISOString(),schedulingEnd=new Date(Date.now()+86400000).toISOString();
let received=false;
const api=new ApiClient(async(path,options)=>{
 const p=String(path).replace(/^\/api/,'');probe.requests.push(p);if(options?.method&&options.method!=='GET')probe.writes.push(p);
 if(writeDelay&&options?.method&&options.method!=='GET')await new Promise<void>(r=>setTimeout(r,writeDelay));
 if(p.startsWith('/connections/c')){
  if(delay)await new Promise<void>(r=>setTimeout(r,delay));
  if(profileMode==='network')throw new TypeError('Synthetic offline');
  if(p.endsWith('/negotiation'))return response({id:'n',connectionId:'c',roundNumber:1,status:'PENDING',confirmedDateTime:null,schedulingExpiresAt:schedulingEnd,createdAt:stamp,updatedAt:stamp});
  if(p.endsWith('/proposals'))return response(received?[1,2,3].map((n)=>({id:`p${n}`,connectionId:'c',userId:'them',roundNumber:1,preferenceOrder:n,proposedDateTime:new Date(Date.now()+(n+1)*3600000).toISOString(),status:'PENDING',createdAt:stamp})):[]);
  if(p.endsWith('/scheduling-availability'))return response({conflictWindowMinutes:60,unavailableWindows:[],serverTime:new Date().toISOString()});
  return response({id:'c',matchId:'m',userAId:'me',userBId:'them',state:'SCHEDULING_PHASE',schedulingExpiresAt:schedulingEnd,createdAt:stamp,updatedAt:stamp});
 }
 if(p==='/me')return response({id:uid==='fixture'?'me':'other',status:'ACTIVE'});
 if(p==='/me/profile')return response({id:'p',userId:uid==='fixture'?'me':'other',status:'ACTIVE',displayName:'Lucía'});
 if(p==='/me/admin-eligibility')return response({eligible:false});
 if(p==='/reference/affinity-questions')return response({catalogVersion:'empty',categories:[],questions:[]});if(p==='/me/profile/affinity-answers')return response({answers:[]});
 if(p==='/me/home/status')return response({version:1,dirty:true,nextRefreshAt:null,serverTime:new Date().toISOString()});
 if(p==='/me/home'){
  if(homeFailure)throw new TypeError('Synthetic offline');
  const pendingActions:unknown[]=schedulingFlow||decided||expired?[]:[{type:'VISUAL_REVIEW',matchId:'m',partner:{displayName:'María'},visualStartedAt:new Date(Date.now()-1000).toISOString(),visualExpiresAt:expiry()}];
  if(remaining==='visual')pendingActions.push({type:'VISUAL_REVIEW',matchId:'other',partner:{displayName:'Otra persona'},visualExpiresAt:expiry()});
  const nextSteps=schedulingFlow?[{type:'SCHEDULING',matchId:'m',connectionId:'c',requiresAction:true,partner:{displayName:'María'},createdAt:stamp,schedulingExpiresAt:schedulingEnd}]:remaining==='scheduling'?[{type:'SCHEDULING',matchId:'s',connectionId:'connection',requiresAction:false}]:remaining==='second'?[{type:'SECOND_CHAT_SCHEDULED',matchId:'s',connectionId:'connection',requiresAction:false,secondChat:{availableAt:new Date(Date.now()+3600000).toISOString(),entryClosesAt:new Date(Date.now()+4500000).toISOString(),expiresAt:new Date(Date.now()+10800000).toISOString(),durationMinutes:120,myAttendanceStatus:'PENDING',chatId:null,chatStatus:null}}]:[];
  return response({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:pendingActions.length,activeConnectionCount:nextSteps.length,actionableConnectionCount:0,hasPendingSchedulingConnection:(remaining==='pending'||remaining==='preparing')},pendingActions,nextSteps,passiveNotices:remaining==='notice'?[{type:'OTHER_NOTICE'}]:remaining==='preparing'?[{type:'SCHEDULING_PREPARING'}]:[]});
 }
 if(p.endsWith('/visual-decision')||p.endsWith('/block')){decided=true;return response({id:p.endsWith('/block')?'block':'m',state:'VISUAL_PHASE'});}
 if(p.endsWith('/personal-messages/me')){saved=true;return new Response(null,{status:204});}
 if(p==='/matches/m'||p==='/matches/m/visual-profile'){
  if(delay)await new Promise<void>(r=>{const done=()=>{releases.delete(done);r();};releases.add(done);setTimeout(done,delay);});
  if(profileMode==='network')throw new TypeError('Synthetic offline');if(profileMode==='forbidden')return response({code:'VISUAL_CONTENT_NOT_AVAILABLE'},403);
  if(p==='/matches/m')return response({id:'m',userAId:'me',userBId:'them',state:expired?'EXPIRED':'VISUAL_PHASE'});
  return response({profileId:'partner',displayName:'María',age:29,bio:'Perfil sintético para pruebas.',visualExpiresAt:expiry(),myPersonalMessageSubmitted:saved,partnerPersonalMessageSubmitted:false,partnerPersonalMessageRead:false,decisionRequiresPartnerPersonalMessageRead:false,photos:[0,1,2,3].map(position=>({id:String(position),position,url:`https://synthetic.example/photo-${position}?X-Amz-Signature=${signature}`,moderationStatus:'APPROVED'})),affinityIndicators:[{categoryId:'outdoors',title:'Aire libre'}],profileQuestions:[{questionId:'q',prompt:'Lugar favorito',answer:'El bosque',position:0}]});
 }
 throw new Error(`Unexpected synthetic endpoint ${p}`);
});
const manager=new TabOwnershipManager();
function Owned(){const [controller]=useState(()=>new SessionController({observe:next=>{observer=next;next(identity());return()=>{observer=()=>{};};},signIn:async()=>identity(),signUp:async()=>identity(),google:async()=>identity(),verify:async()=>{},signOut:async()=>observer(null)},api.withOwnership(manager),false,manager));const s=useSyncExternalStore(controller.subscribe,controller.getSnapshot);probe.owner=s.account?.id??s.phase;probe.authContextVersion=s.authContextVersion??0;return s.phase==='ready'?<Home key={`${s.account?.id}/${s.profile?.id}`} controller={controller}/>:<p>{s.phase==='login'?'Sesión finalizada':'Preparando sesión'}</p>;}
Object.assign(window,{visualProbe:probe,visualFixture:{notify:()=>observer(identity()),replace:()=>{uid='replacement';observer(identity());},logout:()=>observer(null),profileMode:(value:string)=>{profileMode=value;},delay:(ms:number)=>{delay=ms;},writeDelay:(ms:number)=>{writeDelay=ms;},release:()=>{for(const r of releases)r();},signature:()=>{signature++;},homeFailure:(value:boolean)=>{homeFailure=value;},remaining:(value:string)=>{remaining=value;},received:()=>{received=true;window.dispatchEvent(new Event('online'));},expire:()=>{expired=true;window.dispatchEvent(new Event('online'));},owner:manager}});
let previous:Element|null=null;
new MutationObserver(()=>{const profile=document.querySelector('.visual-profile');if(profile!==previous){if(previous)probe.profileRemovals++;if(profile)probe.profileMounts++;previous=profile;}const c=document.querySelector('.visual-content');if(c&&getComputedStyle(c).visibility==='hidden')probe.hiddenContent++;}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});
document.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement&&e.target.closest('.visual-profile'))probe.imageLoads++;},true);
const frame=()=>{if(document.visibilityState==='visible'&&document.querySelector('.visual-review')){const p=document.querySelector('.visual-profile'),c=document.querySelector('.visual-content');if(!p||c&&getComputedStyle(c).visibility==='hidden')probe.blankFrames++;}requestAnimationFrame(frame);};requestAnimationFrame(frame);
createRoot(document.getElementById('root')!).render(<TabGate manager={manager}>{()=> <Owned/>}</TabGate>);
