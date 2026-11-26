// Synthetic lifecycle scheduler and HTTP contract. No production backend/accounts.
import { flattenRecording } from '../src/chat/mp4Recording.ts';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
export const iso = n => new Date(n).toISOString();
export function scenario(overrides = {}) {
  const now = Date.now();
  return { now, scheduled: now-12*60000, joined: new Set(['a','b']), messages: [], resolution: null, claim: null, status: 'ACTIVE', endedReason: null, retention: now+3600000, cooldown: null, writableAudio: false, audioVersion: 1, audioReads: 0, writes: [], inaccessible: false, failSend: false, failUpload: false, gate: null, ...overrides };
}
export function advance(s, ms) {
  s.now += ms;
  if (s.claim && s.now >= Date.parse(s.claim.expiresAt)) { s.status='ABANDONED'; s.endedReason='SECOND_CHAT_NO_SHOW'; s.claim=null; }
  if (s.resolution && s.now >= Date.parse(s.resolution.expiresAt)) {
    if (s.resolution.type === 'PARTNER_INACTIVITY') { s.status='ABANDONED'; s.endedReason='SECOND_CHAT_PARTNER_INACTIVITY'; }
    else s.cooldown=s.now+60000;
    s.resolution=null;
  }
  if (s.cooldown && s.now >= s.cooldown) s.cooldown=null;
}
export async function fixtureServer() {
  const scenarios = new Map();
  const recording = await readFile(new URL('../src/chat/fixtures/chrome-aac-fragmented.mp4',import.meta.url));
  const audio = Buffer.from(flattenRecording(new Uint8Array(recording).buffer,2097152));
  let origin;
  const server = createServer(async(req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const [,group,me,...parts]=req.url.split('/'), path='/'+parts.join('/'),s=scenarios.get(group),other=me==='a'?'b':'a';
    if(!s){res.writeHead(404);res.end('{}');return;}
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(path.startsWith('/audio-')) { s.audioReads++; if(path.includes('expired')){s.audioVersion=2;res.writeHead(403);res.end();}else{res.writeHead(200,{'Content-Type':'audio/mp4','Accept-Ranges':'bytes'});res.end(audio);}return; }
    let bytes=[];for await(const chunk of req)bytes.push(chunk);const raw=Buffer.concat(bytes).toString('utf8'),data=req.headers['content-type']?.includes('application/json')&&raw?JSON.parse(raw):{};
    s.reads??=[];if(req.method==='GET')s.reads.push({me,path});
    if(req.method==='GET' && path.includes('/messages?') && s.historyGate?.me===me){
      const gate=s.historyGate;s.historyGate=null;
      await gate.promise;
    }
    if(req.method!=='GET')s.writes.push({me,path,body:data,raw});
    if(s.gate?.path===path&&req.method==='POST'){const gate=s.gate;s.gate=null;gate.started=true;await new Promise(r=>gate.release=r);}
    if(path==='/me/home/status')return json({version:s.writes.length+1,dirty:true,nextRefreshAt:null,serverTime:iso(s.now)});
    if(path==='/me/profile')return json({id:'profile',userId:me,status:'ACTIVE',displayName:me==='a'?'Ana':'Bruno'});
    const retained=['FINISHED','EXPIRED','ABANDONED'].includes(s.status);
    const metadata={availableAt:iso(s.scheduled),entryClosesAt:iso(s.scheduled+15*60000),expiresAt:iso(s.scheduled+120*60000),readOnlyUntil:retained?iso(s.retention):null,chatId:s.joined.size?'c':null,chatStatus:s.status,chatType:'SECOND_CHAT',myAttendanceStatus:s.attendance?.[me]??(s.joined.has(me)?'ON_TIME':'PENDING'),durationMinutes:120};
    if(path==='/me/home' && s.scheduling)return json({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:0,activeConnectionCount:1,actionableConnectionCount:1,hasPendingSchedulingConnection:true},pendingActions:[],nextSteps:[{type:'SCHEDULING',connectionId:'connection',matchId:'m',partner:{displayName:other==='a'?'Ana':'Bruno'},requiresAction:s.requiresAction,createdAt:iso(s.now-60000),schedulingExpiresAt:iso(s.now+3600000)}],passiveNotices:[]});
    if(path==='/me/home')return json({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:0,activeConnectionCount:1,actionableConnectionCount:1,hasPendingSchedulingConnection:false},pendingActions:[],nextSteps:s.inaccessible||['CANCELLED','CLOSED'].includes(s.status)?[]:[{type:s.homeType??(retained?'SECOND_CHAT_READ_ONLY':'SECOND_CHAT_AVAILABLE'),connectionId:'connection',matchId:'m',partner:{displayName:other==='a'?'Ana':'Bruno'},requiresAction:false,secondChat:metadata}],passiveNotices:[]});
    if(path==='/reference/affinity-questions')return json({categories:[],questions:[]});
    if(path==='/me/profile/affinity-answers')return json([]);
    if(s.inaccessible)return json({code:'CHAT_NOT_AVAILABLE'},403);
    if(path==='/matches/m')return json({id:'m',userAId:'a',userBId:'b',state:'VISUAL_APPROVED',connectionId:'connection',visualExpiresAt:null,createdAt:iso(s.scheduled),updatedAt:iso(s.now)});
    const policy={enabledAt:null,enabled:s.writableAudio,unavailableReason:s.writableAudio?null:'FEATURE_DISABLED',maxDurationMillis:60000,maxFileSizeBytes:1000000,remainingMessages:null};
    const attendance=()=> ({connectionId:'connection',chatId:s.joined.size?'c':null,scheduledAt:iso(s.scheduled),onTimeUntil:iso(s.scheduled+5*60000),entryClosesAt:iso(s.scheduled+15*60000),absoluteExpiresAt:iso(s.scheduled+120*60000),serverTime:iso(s.now),myJoinedAt:s.joined.has(me)?iso(s.scheduled):null,partnerJoinedAt:s.joined.has(other)?iso(s.scheduled):null,endedAt:retained?iso(s.now):null,mutualCompletionEligibleAt:null,inactivityClaimableAt:null,inactivityClosesAt:null,lastMessageAt:s.messages.at(-1)?.sentAt??null,lastMessageSenderId:s.messages.at(-1)?.senderId??null,myAttendanceStatus:s.joined.has(me)?'ON_TIME':'PENDING',partnerAttendanceStatus:s.joined.has(other)?'ON_TIME':'PENDING',canJoin:!s.joined.has(me)&&s.now>=s.scheduled&&s.now<s.scheduled+15*60000,canClaimPartnerNoShow:s.joined.has(me)&&!s.joined.has(other)&&!s.claim&&s.now<s.scheduled+15*60000,activeNoShowClaim:s.claim,activeResolutionRequest:s.resolution,chatStatus:s.status,conversationStartedAt:s.joined.size===2?iso(s.scheduled):null,readOnlyUntil:retained?iso(s.retention):null,endedReason:s.endedReason,canRequestMutualCompletion:s.joined.size===2&&!s.resolution&&!s.cooldown&&s.status==='ACTIVE',mutualCompletionCooldownUntil:s.cooldown?iso(s.cooldown):null,canClaimPartnerInactivity:s.messages.at(-1)?.senderId===me&&!s.resolution,mustRespondToPartner:s.resolution?.type==='PARTNER_INACTIVITY'&&s.resolution.responderUserId===me,audioPolicy:policy});
    // ChatResponse contains lifecycle metadata only, never a partner summary.
    const chat=()=>({id:'c',connectionId:'connection',matchId:'m',chatType:'SECOND_CHAT',status:s.status,startedAt:iso(s.scheduled),availableAt:iso(s.scheduled),activatedAt:iso(s.scheduled),conversationStartedAt:s.joined.size===2?iso(s.scheduled):null,timeoutAt:iso(s.scheduled+120*60000),expiresAt:iso(s.scheduled+120*60000),endedAt:retained?iso(s.now):null,readOnlyUntil:retained?iso(s.retention):null,lastMessageAt:s.messages.at(-1)?.sentAt??null,lastMessageSenderId:s.messages.at(-1)?.senderId??null,inactivityExpiresAt:null,audioPolicy:policy});
    if(path.endsWith('/status')){if(s.failStatus)return json({code:'TEMPORARILY_UNAVAILABLE'},503);return json(attendance());}
    if(path.endsWith('/join')){if(s.now>=s.scheduled+15*60000)return json({code:'SECOND_CHAT_ENTRY_CLOSED'},409);s.joined.add(me);s.status='ACTIVE';s.claim=null;if(s.uncertainJoin){s.failStatus=true;return json({code:'TEMPORARILY_UNAVAILABLE'},503);}return json(attendance());}
    const request=type=>({id:'r',type,requesterUserId:me,responderUserId:other,referenceMessageId:null,status:'PENDING',createdAt:iso(s.now),expiresAt:iso(Math.min(s.now+60000,type==='PARTNER_NO_SHOW'?s.scheduled+15*60000:s.scheduled+120*60000))});
    if(path.endsWith('/no-show-claims')){if(s.joined.has(other))return json({code:'SECOND_CHAT_PARTNER_ALREADY_JOINED'},409);s.claim=request('PARTNER_NO_SHOW');return json(attendance());}
    if(path.endsWith('/completion-requests')){s.resolution=request('MUTUAL_COMPLETION');return json(attendance());}
    if(path.endsWith('/inactivity-claims')){s.resolution=request('PARTNER_INACTIVITY');return json(attendance());}
    if(path.endsWith('/decision')){if(data.decision==='ACCEPTED'){s.status='FINISHED';s.endedReason='SECOND_CHAT_MUTUAL_COMPLETION';}else s.cooldown=s.now+60000;s.resolution=null;return json(attendance());}
    if(path.endsWith('/block')){s.inaccessible=true;return json({id:'block',source:'MANUAL',createdAt:iso(s.now)});}
    if(path.endsWith('/safety-cancellations')){s.status='CANCELLED';return json({chat:chat(),exitRequest:{id:'exit',chatId:'c',requesterUserId:me,responderUserId:other,type:'SAFETY_REPORT',status:'ACCEPTED',reason:data.reason,details:data.details,createdAt:iso(s.now),resolvedAt:iso(s.now)},penaltyApplied:false,penalizedUserId:null});}
    if(req.method==='POST'&&(path.endsWith('/messages')||path.endsWith('/audio-messages'))){
      if(path.endsWith('/audio-messages')&&s.audioTerminal){s.status='ABANDONED';s.endedReason='SECOND_CHAT_NO_CONVERSATION_STARTED';return json({code:'SECOND_CHAT_CONVERSATION_ALREADY_RESOLVED'},409);}
      if(path.endsWith('/audio-messages')&&s.audioRecoverable)return json({code:'CHAT_AUDIO_WAITING_FOR_BOTH'},409);
      if(s.failSend||s.failUpload&&path.endsWith('/audio-messages'))return json({code:'TEMPORARILY_UNAVAILABLE'},503);
      const m={id:String(s.messages.length+1),chatSessionId:'c',senderId:me,clientMessageId:path.endsWith('/audio-messages')?raw.match(/name="clientMessageId"\r\n\r\n([^\r\n]+)/)?.[1]:data.clientMessageId,messageType:path.endsWith('/audio-messages')?'AUDIO':'TEXT',content:path.endsWith('/audio-messages')?null:data.content,sentAt:iso(s.now),replyTo:null,reactionType:null,audio:path.endsWith('/audio-messages')?{url:`${origin}/${group}/${me}/audio-valid`,durationMillis:1000,sizeBytes:2000,contentType:'audio/mp4'}:null};s.messages.push(m);if(s.audioCommitAmbiguous&&path.endsWith('/audio-messages')){s.status='ABANDONED';s.endedReason='SECOND_CHAT_NO_CONVERSATION_STARTED';return json({code:'TEMPORARILY_UNAVAILABLE'},503);}if(s.resolution?.type==='MUTUAL_COMPLETION')s.cooldown=s.now+60000;s.resolution=null;return json(m);
    }
    if(path==='/chats/c'){if(s.failChatReadOnce){s.failChatReadOnce=false;return json({code:'TEMPORARILY_UNAVAILABLE'},503);}return json(chat());}
    if(path.includes('/messages?')) {
      res.setHeader('X-Reals-Counterpart-Audio-Access',s.audioAccess ?? 'ALLOWED');
      res.setHeader('Access-Control-Expose-Headers','X-Reals-Counterpart-Audio-Access');
      res.setHeader('Cache-Control','no-store');
      const messages=s.messages.map(m=>m.audio?{...m,audio:{...m.audio,url:`${origin}/${group}/${me}/audio-${s.audioVersion===1?'expired':'valid'}`}}:m);
      return json(path.includes('&after=')?{messages,hasMore:false,serverTime:iso(s.now)}:messages);
    }
    return json({});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  return {server,scenarios,origin};
}
