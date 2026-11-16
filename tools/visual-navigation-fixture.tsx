import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from '../src/home/Home';
import { ApiClient } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import type { Identity } from '../src/auth/firebase';
import { TabGate } from '../src/tabs/TabGate';
import { TabOwnershipManager } from '../src/tabs/TabOwnershipManager';
import { VisualSession } from '../src/visual/VisualSession';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/auth/login.css';
const probe={sessions:0,disposed:0,conceals:0,resumes:0,hiddenContent:0,profileMounts:0,profileRemovals:0,imageLoads:0,blankFrames:0,owner:'',authContextVersion:0,transitions:[] as string[],requests:[] as string[],writes:[] as string[]};
const sessions=new WeakSet<VisualSession>();
const originalStart=VisualSession.prototype.start,originalDispose=VisualSession.prototype.dispose;
VisualSession.prototype.start=function(){if(!sessions.has(this)){sessions.add(this);probe.sessions++;const conceal=this.conceal,resume=this.resume;this.conceal=()=>{probe.conceals++;conceal();probe.transitions.push(`conceal:${this.getSnapshot().concealed}`);};this.resume=()=>{probe.resumes++;const r=resume();probe.transitions.push(`resume:${this.getSnapshot().concealed}`);return r;};}originalStart.call(this);};
VisualSession.prototype.dispose=function(){probe.disposed++;originalDispose.call(this);};
let observer:(user:Identity|null)=>void=()=>{},uid='fixture',homeFailure=false,profileMode='ok',delay=0,writeDelay=0,signature=0,decided=false,saved=false,remaining='none',expired=false;
const releases=new Set<()=>void>();
const identity=():Identity=>({uid,emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const expiry=()=>new Date(Date.now()+(expired?-1000:3600000)).toISOString();
const api=new ApiClient(async(path,options)=>{
 const p=String(path).replace(/^\/api/,'');probe.requests.push(p);if(options?.method&&options.method!=='GET')probe.writes.push(p);
 if(writeDelay&&options?.method&&options.method!=='GET')await new Promise<void>(r=>setTimeout(r,writeDelay));
 if(p==='/me')return response({id:uid==='fixture'?'me':'other',status:'ACTIVE'});
 if(p==='/me/profile')return response({id:'p',userId:uid==='fixture'?'me':'other',status:'ACTIVE',displayName:'Lucía'});
 if(p==='/me/admin-eligibility')return response({eligible:false});
 if(p==='/reference/affinity-questions')return response({catalogVersion:'empty',categories:[],questions:[]});if(p==='/me/profile/affinity-answers')return response({answers:[]});
 if(p==='/me/home/status')return response({version:1,dirty:true,nextRefreshAt:null,serverTime:new Date().toISOString()});
 if(p==='/me/home'){
  if(homeFailure)throw new TypeError('Synthetic offline');
  const pendingActions:unknown[]=decided||expired?[]:[{type:'VISUAL_REVIEW',matchId:'m',partner:{displayName:'María'},visualStartedAt:new Date(Date.now()-1000).toISOString(),visualExpiresAt:expiry()}];
  if(remaining==='visual')pendingActions.push({type:'VISUAL_REVIEW',matchId:'other',partner:{displayName:'Otra persona'},visualExpiresAt:expiry()});
  const nextSteps=remaining==='scheduling'?[{type:'SCHEDULING',matchId:'s',connectionId:'connection',requiresAction:false}]:remaining==='second'?[{type:'SECOND_CHAT_SCHEDULED',matchId:'s',connectionId:'connection',requiresAction:false,secondChat:{availableAt:new Date(Date.now()+3600000).toISOString(),entryClosesAt:new Date(Date.now()+4500000).toISOString(),expiresAt:new Date(Date.now()+10800000).toISOString(),durationMinutes:120,myAttendanceStatus:'PENDING',chatId:null,chatStatus:null}}]:[];
  return response({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:pendingActions.length,activeConnectionCount:nextSteps.length,actionableConnectionCount:0,hasPendingSchedulingConnection:remaining==='pending'},pendingActions,nextSteps,passiveNotices:remaining==='notice'?[{type:'SCHEDULING_PREPARING'}]:[]});
 }
 if(p.endsWith('/visual-decision')||p.endsWith('/block')){decided=true;return response({id:p.endsWith('/block')?'block':'m',state:'VISUAL_PHASE'});}
 if(p.endsWith('/personal-messages/me')){saved=true;return new Response(null,{status:204});}
 if(p==='/matches/m'||p==='/matches/m/visual-profile'){
  if(delay)await new Promise<void>(r=>{const done=()=>{releases.delete(done);r();};releases.add(done);setTimeout(done,delay);});
  if(profileMode==='network')throw new TypeError('Synthetic offline');if(profileMode==='forbidden')return response({code:'VISUAL_CONTENT_NOT_AVAILABLE'},403);
  if(p==='/matches/m')return response({id:'m',userAId:'me',userBId:'them',state:expired?'EXPIRED':'VISUAL_PHASE'});
  return response({profileId:'partner',displayName:'María',age:29,bio:'Perfil sintético para pruebas.',visualExpiresAt:expiry(),myPersonalMessageSubmitted:saved,partnerPersonalMessageSubmitted:false,partnerPersonalMessageRead:false,decisionRequiresPartnerPersonalMessageRead:false,photos:[0,1,2,3].map(position=>({id:String(position),position,url:`https://synthetic.example/photo-${position}?X-Amz-Signature=${signature}`,moderationStatus:'APPROVED'})),affinityIndicators:[],profileQuestions:[]});
 }
 throw new Error(`Unexpected synthetic endpoint ${p}`);
});
const manager=new TabOwnershipManager();
function Owned(){const [controller]=useState(()=>new SessionController({observe:next=>{observer=next;next(identity());return()=>{observer=()=>{};};},signIn:async()=>identity(),signUp:async()=>identity(),google:async()=>identity(),verify:async()=>{},signOut:async()=>observer(null)},api.withOwnership(manager),false,manager));const s=useSyncExternalStore(controller.subscribe,controller.getSnapshot);probe.owner=s.account?.id??s.phase;probe.authContextVersion=s.authContextVersion??0;return s.phase==='ready'?<Home key={`${s.account?.id}/${s.profile?.id}`} controller={controller}/>:<p>{s.phase==='login'?'Sesión finalizada':'Preparando sesión'}</p>;}
Object.assign(window,{visualProbe:probe,visualFixture:{notify:()=>observer(identity()),replace:()=>{uid='replacement';observer(identity());},logout:()=>observer(null),profileMode:(value:string)=>{profileMode=value;},delay:(ms:number)=>{delay=ms;},writeDelay:(ms:number)=>{writeDelay=ms;},release:()=>{for(const r of releases)r();},signature:()=>{signature++;},homeFailure:(value:boolean)=>{homeFailure=value;},remaining:(value:string)=>{remaining=value;},expire:()=>{expired=true;window.dispatchEvent(new Event('online'));},owner:manager}});
let previous:Element|null=null;
new MutationObserver(()=>{const profile=document.querySelector('.visual-profile');if(profile!==previous){if(previous)probe.profileRemovals++;if(profile)probe.profileMounts++;previous=profile;}const c=document.querySelector('.visual-content');if(c&&getComputedStyle(c).visibility==='hidden')probe.hiddenContent++;}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class']});
document.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement&&e.target.closest('.visual-profile'))probe.imageLoads++;},true);
const frame=()=>{if(document.visibilityState==='visible'&&document.querySelector('.visual-review')){const p=document.querySelector('.visual-profile'),c=document.querySelector('.visual-content');if(!p||c&&getComputedStyle(c).visibility==='hidden')probe.blankFrames++;}requestAnimationFrame(frame);};requestAnimationFrame(frame);
createRoot(document.getElementById('root')!).render(<TabGate manager={manager}>{()=> <Owned/>}</TabGate>);
