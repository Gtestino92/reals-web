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
export function secondHarness() {
  const controller = controllerFixture(), status = secondFixture(), messages: Message[] = [];
  const request = vi.spyOn(controller,'request').mockImplementation(async (path,_signal,method,body) => {
    if (path === '/matches/m') return {id:'m',userAId:'me',userBId:'them'};
    if (path.endsWith('/status')) return structuredClone(status);
    if (path === '/chats/c') return {id:'c',matchId:'m',connectionId:'connection',chatType:'SECOND_CHAT',partner:{userId:'them',displayName:'María'}};
    if (method === 'POST' && path.endsWith('/messages')) {
      if (!body || typeof body !== 'object' || !('clientMessageId' in body)) throw Error();
      const message = {...messageFixture('3','me'),clientMessageId:String(body.clientMessageId)}; messages.push(message); return message;
    }
    if (path.includes('/messages?')) return {messages:structuredClone(messages),hasMore:false};
    return {};
  });
  return {controller,status,messages,request};
}
