import { ApiClient } from '../auth/api';
import { SessionController } from '../auth/session';
import type { Availability, Negotiation } from './contracts';
import { vi } from 'vitest';
import { emptyHome } from '../home/fixtures';
export const time='2026-11-15T12:00:00Z';
export const negotiation=(overrides={}): Negotiation=>({id:'n',connectionId:'c',roundNumber:1,status:'PENDING',confirmedDateTime:null,schedulingExpiresAt:'2026-11-16T12:00:00Z',createdAt:time,updatedAt:time,...overrides});
export const proposal=(overrides={})=>({id:'p1',connectionId:'c',userId:'them',roundNumber:1,preferenceOrder:1,proposedDateTime:'2026-11-15T16:00:00Z',status:'PENDING' as const,createdAt:time,...overrides});
export const availability=(): Availability=>({conflictWindowMinutes:60,unavailableWindows:[],serverTime:time});
export function setup() {
 const controller=new SessionController({observe:()=>()=>{},signIn:vi.fn(),signUp:vi.fn(),google:vi.fn(),verify:vi.fn(),signOut:vi.fn()},new ApiClient(),false);
 controller.snapshot={...controller.snapshot,phase:'ready',account:{id:'me',status:'ACTIVE'},profile:{id:'profile',userId:'me',status:'ACTIVE'}};
 const state={n:negotiation(),p:[] as ReturnType<typeof proposal>[],a:availability(),c:{id:'c',matchId:'m',userAId:'me',userBId:'them',state:'SCHEDULING_PHASE',schedulingExpiresAt:'2026-11-16T12:00:00Z',createdAt:time,updatedAt:time}};
 const request=vi.spyOn(controller,'request').mockImplementation(async path=>{
  if(path==='/me/home')return emptyHome();
  if(path.endsWith('/negotiation'))return state.n;
  if(path.endsWith('/proposals'))return state.p;
  if(path.endsWith('/scheduling-availability'))return state.a;
  return state.c;
 });
 return {controller,state,request};
}
