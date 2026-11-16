import { vi } from 'vitest';
import { controllerFixture, messageFixture } from './fixtures';
import type { Message } from './contracts';
import type { SecondStatus } from './secondContracts';
export const secondFixture = (): SecondStatus => ({
  connectionId:'connection',chatId:'c',scheduledAt:'2026-11-13T12:00:00Z',onTimeUntil:'2026-11-13T12:05:00Z',entryClosesAt:'2026-11-13T12:15:00Z',absoluteExpiresAt:'2026-11-13T14:00:00Z',serverTime:'2026-11-13T12:12:00Z',
  myAttendanceStatus:'ON_TIME',partnerAttendanceStatus:'ON_TIME',myJoinedAt:'2026-11-13T12:00:00Z',partnerJoinedAt:'2026-11-13T12:01:00Z',canJoin:false,canClaimPartnerNoShow:false,
  activeNoShowClaim:null,activeResolutionRequest:null,chatStatus:'ACTIVE',conversationStartedAt:'2026-11-13T12:01:00Z',readOnlyUntil:null,endedAt:null,endedReason:null,
  mutualCompletionEligibleAt:'2026-11-13T12:11:00Z',canRequestMutualCompletion:true,mutualCompletionCooldownUntil:null,inactivityClaimableAt:null,inactivityClosesAt:null,canClaimPartnerInactivity:false,mustRespondToPartner:false,lastMessageAt:null,lastMessageSenderId:null,
  audioPolicy:{enabled:true,unavailableReason:null,maxDurationMillis:60000,maxFileSizeBytes:1000000,remainingMessages:null},
});
// ChatController.getChat -> ChatResponse (not FirstChatResponse: no partner).
export const secondChatResponse = (status = secondFixture()) => ({
  id: status.chatId, matchId:'m', connectionId:status.connectionId, chatType:'SECOND_CHAT', status:status.chatStatus,
  startedAt:status.scheduledAt, availableAt:status.scheduledAt, activatedAt:status.myJoinedAt,
  conversationStartedAt:status.conversationStartedAt, timeoutAt:status.absoluteExpiresAt, expiresAt:status.absoluteExpiresAt,
  endedAt:status.endedAt, readOnlyUntil:status.readOnlyUntil, lastMessageAt:status.lastMessageAt,
  lastMessageSenderId:status.lastMessageSenderId, inactivityExpiresAt:status.inactivityClosesAt,
  audioPolicy:status.audioPolicy ? {...status.audioPolicy,enabledAt:null} : null,
});
export const secondSafetyResponse = (status = secondFixture()) => ({
  chat:{...secondChatResponse(status),status:'CANCELLED'},
  exitRequest:{id:'exit',chatId:status.chatId,requesterUserId:'me',responderUserId:'them',type:'SAFETY_REPORT',status:'ACCEPTED',reason:'HARASSMENT',details:null,createdAt:status.serverTime,resolvedAt:status.serverTime},
  penaltyApplied:false,penalizedUserId:null,
});
// Extra nullable policy timestamp is serialized by the backend but unused by Web.
export const secondStatusResponse = (status = secondFixture()) => ({...status,audioPolicy:status.audioPolicy ? {...status.audioPolicy,enabledAt:null} : null});
export function secondHarness() {
  const controller = controllerFixture(), status = secondFixture(), messages: Message[] = [];
  const request = vi.spyOn(controller,'request').mockImplementation(async (path,_signal,method,body) => {
    if (path === '/matches/m') return {id:'m',userAId:'me',userBId:'them',state:'VISUAL_APPROVED',connectionId:'connection',visualExpiresAt:null,createdAt:status.scheduledAt,updatedAt:status.serverTime};
    if (method === 'POST' && path.endsWith('/join')) {
      Object.assign(status,{canJoin:false,myAttendanceStatus:'LATE',myJoinedAt:status.serverTime,chatId:'c',chatStatus:'ACTIVE'});
      return structuredClone(secondStatusResponse(status));
    }
    if (path.endsWith('/safety-cancellations')) return secondSafetyResponse(status);
    if (path.endsWith('/block')) return {id:'block',source:'MANUAL',createdAt:status.serverTime};
    if (path.endsWith('/status') || method === 'POST' && path.includes('/second-chat/')) return structuredClone(secondStatusResponse(status));
    if (path === '/chats/c') return secondChatResponse(status);
    if (method === 'POST' && path.endsWith('/messages')) {
      if (!body || typeof body !== 'object' || !('clientMessageId' in body)) throw Error();
      const message = {...messageFixture('3','me'),clientMessageId:String(body.clientMessageId)}; messages.push(message); return message;
    }
    if (path.includes('/messages?')) return path.includes('&after=') ? {messages:structuredClone(messages),hasMore:false,serverTime:status.serverTime} : structuredClone(messages);
    return {};
  });
  return {controller,status,messages,request};
}
