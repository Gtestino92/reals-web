import { expect, it } from 'vitest';
import { parseSecondStatus, secondPolicy, type SecondStatus } from './secondContracts';
import { secondFixture } from './secondFixtures';
const at = (time: string) => Date.parse(`2026-11-13T${time}Z`);
it.each(['11:59:59','12:00:00','12:04:59','12:05:00','12:14:59','12:15:00','14:00:00'])('fences explicit admission at %s', time => {
  const s = {...secondFixture(),canJoin:true,myAttendanceStatus:'PENDING' as const};
  const now=at(time); expect(secondPolicy(s,now).canJoin).toBe(now>=at('12:00:00')&&now<at('12:15:00'));
});
it.each(['ON_TIME','LATE'] as const)('allows %s attendance messaging while partner waits without disabling audio',attendance => {
  const s = {...secondFixture(),myAttendanceStatus:attendance,partnerAttendanceStatus:'PENDING' as const};
  expect(secondPolicy(s,at('12:12:00'))).toMatchObject({writable:true,canReturn:false}); expect(s.audioPolicy?.enabled).toBe(true);
  expect(secondPolicy(s,at('12:15:00')).canReturn).toBe(true);
});
it.each(['FINISHED','ABANDONED','EXPIRED','CANCELLED','CLOSED','AVAILABLE'] as const)('handles terminal/read-only %s',chatStatus => {
  const s = {...secondFixture(),chatStatus,readOnlyUntil:'2026-11-13T15:00:00Z'};
  expect(secondPolicy(s,at('14:00:00'))).toMatchObject({writable:false,canReturn:true,readable:['FINISHED','ABANDONED','EXPIRED'].includes(chatStatus)});
  expect(secondPolicy(s,at('15:00:00')).readable).toBe(false);
});
it('does not synthesize terminal state at absolute expiry',()=>{const s=secondFixture();expect(secondPolicy(s,at('14:00:00'))).toMatchObject({expired:true,writable:false});expect(s.chatStatus).toBe('ACTIVE');});
it.each(['canJoin','canClaimPartnerNoShow','canRequestMutualCompletion','canClaimPartnerInactivity','mustRespondToPartner','scheduledAt','entryClosesAt','serverTime','myAttendanceStatus','partnerAttendanceStatus','chatStatus','audioPolicy'])('rejects malformed %s',key=>{expect(()=>parseSecondStatus({...secondFixture(),[key]:{}},'connection',['me','them'])).toThrow();});
it('rejects foreign identities, participants and inverted windows',()=>{
  expect(()=>parseSecondStatus(secondFixture(),'foreign',['me','them'])).toThrow();
  expect(()=>parseSecondStatus({...secondFixture(),lastMessageSenderId:'intruder'},'connection',['me','them'])).toThrow();
  expect(()=>parseSecondStatus({...secondFixture(),entryClosesAt:'2026-11-13T11:00:00Z'},'connection',['me','them'])).toThrow();
});
it.each(['MUTUAL_COMPLETION','PARTNER_INACTIVITY','PARTNER_NO_SHOW'] as const)('fences %s deadline while allowing predeadline messages',type=>{
  const s=secondFixture(), request={id:'r',type,requesterUserId:'me',responderUserId:'them',status:'PENDING' as const,createdAt:s.serverTime,expiresAt:'2026-11-13T12:13:00Z',referenceMessageId:null};
  if(type==='PARTNER_NO_SHOW')s.activeNoShowClaim=request;else s.activeResolutionRequest=request;
  expect(secondPolicy(s,at('12:12:59')).writable).toBe(true);expect(secondPolicy(s,at('12:13:00')).writable).toBe(false);
});
it('keeps capabilities authoritative and waits for cooldown reconciliation',()=>{
  const s=secondFixture(); expect(secondPolicy(s,at('12:12:00')).completion).toBe(true);
  s.canRequestMutualCompletion=false;expect(secondPolicy(s,at('12:12:00')).completion).toBe(false);
  s.canRequestMutualCompletion=true;s.mutualCompletionCooldownUntil='2026-11-13T12:13:00Z';expect(secondPolicy(s,at('12:14:00')).completion).toBe(false);
});
it('validates the complete status roundtrip',()=>{const s:SecondStatus=secondFixture();expect(parseSecondStatus(s,'connection',['me','them'])).toEqual(s);});
