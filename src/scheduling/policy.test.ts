import { afterEach, expect, it, vi } from 'vitest';
import { conflicts, days, localSlot, reviewReason, roundState, validateSlots } from './policy';
import { availability, negotiation, proposal, time } from './fixtures';
import { timestamp, parseAvailability, parseConnection, parseNegotiation, parseProposals } from './contracts';
const now=Date.parse(time);
afterEach(()=>vi.restoreAllMocks());
it.each([
 [true,null,[],'Loading'],[false,null,[],'Unknown'],[false,negotiation(),[],'WaitingForMyProposals'],[false,negotiation(),[proposal({userId:'me'})],'WaitingForPartnerProposals'],[false,negotiation(),[proposal()],'ReviewPartnerProposals'],[false,negotiation({status:'CONFIRMED'}),[],'Scheduled'],[false,negotiation({status:'FAILED'}),[],'Failed'],[false,negotiation({status:'OTHER'}),[],'Unknown'],
] as const)('derives stage %#',(loading,n,p,expected)=>expect(roundState(loading,n,[...p],'me').stage).toBe(expected));
it('filters old rounds, preserves preference order and prioritizes partner review',()=>{
 const r=roundState(false,negotiation(),[proposal({id:'old',roundNumber:2}),proposal({id:'own',userId:'me'}),proposal({id:'two',preferenceOrder:2}),proposal({id:'one',preferenceOrder:1})],'me');
 expect(r.received.map(p=>p.id)).toEqual(['one','two']);expect(r.stage).toBe('ReviewPartnerProposals');
 expect(roundState(false,negotiation(),[proposal({status:'REJECTED'})],'me').stage).toBe('WaitingForMyProposals');
});
it('uses inclusive conflict boundaries across offsets',()=>{
 const a={...availability(),unavailableWindows:[{startsAt:'2026-11-15T15:00:00Z',endsAt:'2026-11-15T17:00:00Z'}]};
 expect(conflicts('2026-11-15T12:00:00-03:00',a)).toBe(true);expect(conflicts('2026-11-15T17:00:00Z',a)).toBe(true);expect(conflicts('2026-11-15T17:00:00.001Z',a)).toBe(false);
});
it.each([
 [[],/al menos/],[Array(4).fill('2026-11-15T16:00:00Z'),/hasta 3/],[['2026-11-15T16:00:00Z','2026-11-15T13:00:00-03:00'],/repetirse/],[['2026-11-15T12:00:00Z'],/pasaron/],[['2026-11-15T12:00:01Z'],/20 minutos/],[['2026-11-15T16:01:00Z'],/media hora/],[['2026-11-23T16:00:00Z'],/seis días/],
])('validates selected slots %#',(values,message)=>expect(validateSlots(values,now,availability())).toMatch(message));
it('accepts exactly twenty minutes and rejects one millisecond less',()=>{
 const slot='2026-11-15T16:00:00Z', boundary=Date.parse(slot)-1200000;
 expect(validateSlots([slot],boundary,availability())).toBe('');expect(validateSlots([slot],boundary+1,availability())).toMatch(/20 minutos/);
});
it('offers seven calendar dates, checks wall times and keeps expired received rows distinguishable',()=>{
 expect(days(now)).toHaveLength(7);expect(localSlot('2026-11-15',12,30)).toContain('12:30:00');expect(localSlot('2026-02-30',12,0)).toBeNull();expect(reviewReason(time,now,availability())).toBe('Vencido');expect(reviewReason('bad',now,availability())).toBe('No disponible');expect(reviewReason(proposal().proposedDateTime,now,null)).toMatch(/sin verificar/);
});
it('rejects invalid availability and preserves timestamp offsets',()=>{
 expect(()=>parseAvailability({})).toThrow();expect(()=>parseAvailability({...availability(),unavailableWindows:[{startsAt:time,endsAt:'2026-11-14T12:00:00Z'}]})).toThrow();
 expect(parseNegotiation(negotiation({confirmedDateTime:'2026-11-15T13:00:00-03:00'}),'c').confirmedDateTime).toBe('2026-11-15T13:00:00-03:00');
 expect(()=>parseNegotiation(negotiation({connectionId:'wrong'}),'c')).toThrow();expect(()=>parseProposals([proposal({userId:'private'})],'c',['me','them'])).toThrow();expect(()=>parseConnection({},'c','m','me')).toThrow();
});

it.each(['2026-02-30T12:00:00Z','2026-11-15T24:00:00Z','2026-11-15','2026-11-15T12:00:00'])('rejects malformed calendar timestamps %s',value=>expect(()=>timestamp(value)).toThrow());
it('preserves insertion ranking for three ordered slots',()=>{
 const values=['2026-11-15T20:00:00Z','2026-11-15T16:00:00Z','2026-11-15T18:30:00Z'];expect(validateSlots(values,now,availability())).toBe('');expect(values[0]).toContain('20:00');
});
