import { vi } from 'vitest';
import { ApiClient } from '../auth/api';
import { SessionController } from '../auth/session';
import type { AuthService } from '../auth/firebase';
export const chatFixture = () => ({ id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:{question:{id:'q',instanceId:'question-1',text:'¿Qué te inspira?'},questionOrdinal:1,maxQuestions:3,requiredParticipationScore:100,directQuestionReplyMultiplier:2,progressionAction:'NEXT_QUESTION',canRequestNext:true,myNextRequested:false,completed:false},audioPolicy:{enabled:true,unavailableReason:null,maxDurationMillis:60000,maxFileSizeBytes:2097152,remainingMessages:2}});
export const messageFixture = (id='1', senderId='them') => ({id,chatSessionId:'c',senderId,clientMessageId:null as string|null,messageType:'TEXT',content:'Hola, ¿cómo estás?',audio:null,reactionType:null as 'HEART'|null,replyTo:null,sentAt:new Date(1000000+Number(id||0)*1000).toISOString()});
export function controllerFixture() {
  const auth: AuthService={observe:vi.fn(),signIn:vi.fn(),signUp:vi.fn(),google:vi.fn(),verify:vi.fn(),signOut:vi.fn()};
  const controller=new SessionController(auth,new ApiClient(),false);
  controller.snapshot={...controller.snapshot,phase:'ready',account:{id:'me',status:'ACTIVE'},profile:{id:'p',userId:'me',status:'ACTIVE'}};
  return controller;
}
