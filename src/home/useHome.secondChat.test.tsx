import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useHome } from './useHome';
import { controllerFixture } from '../chat/fixtures';
import { emptyHome, homeStatus } from './fixtures';
import { ApiError } from '../auth/api';
it.each([false,true])('dismissal reconciles authoritative Home after ambiguous=%s without automatic replay',async ambiguous=>{
 const controller=controllerFixture(),home=emptyHome();let finish:(()=>void)|undefined;
 const request=vi.spyOn(controller,'request').mockImplementation(async(path,_signal,method)=>{
  if(path.endsWith('/second-chat-dismissal')){await new Promise<void>(r=>{finish=r;});if(ambiguous)throw new ApiError('network');return{dismissed:true};}
  if(path==='/me/home/status')return homeStatus();if(path==='/me/home')return home;
  if(path==='/me/profile')return{id:'p',userId:'me',status:'ACTIVE',displayName:'Ana'};
  if(method==='GET')return{};throw Error('Unexpected path');
 });
 const {result}=renderHook(()=>useHome(controller));await waitFor(()=>expect(result.current.busy).toBe(false));
 let pending:Promise<void>|undefined;act(()=>{pending=result.current.dismissSecondChat('connection');});await waitFor(()=>expect(finish).toBeDefined());expect(result.current.busy).toBe(true);
 await act(async()=>{await result.current.dismissSecondChat('connection');result.current.refresh();});expect(result.current.busy).toBe(true);
 await act(async()=>{finish?.();await pending;});expect(result.current.busy).toBe(false);expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);expect(result.current.blocked).toBe(false);
 if(ambiguous)expect(result.current.error).toContain('confirmar');
});
