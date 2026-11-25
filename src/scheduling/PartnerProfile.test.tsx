import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { setup } from './fixtures';
import { visualProfile } from '../visual/fixtures';
import { PartnerProfile } from './PartnerProfile';
function deferred() {let resolve!: (v:unknown)=>void;let reject!: (e:unknown)=>void;const promise=new Promise<unknown>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const blocked=()=>new ApiError('backend',409,'USER_PAIR_BLOCKED');
function mount() {const f=setup();f.request.mockResolvedValue(visualProfile());render(<PartnerProfile controller={f.controller} matchId="m" partnerName="Partner" onBack={()=>{}} menu={null} disabled={false}/>);return f;}
const resume=()=>act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
afterEach(()=>vi.restoreAllMocks());
it('retires installed photos on a deferred partner-message block denial and ignores late image events and resume',async()=>{
 const f=mount();await screen.findByRole('img');const message=deferred();
 f.request.mockImplementation(async path=>path.endsWith('/partner')?message.promise:visualProfile({partnerPersonalMessageSubmitted:true}));
 await resume();const image=screen.getByRole('img');expect(image).toBeInTheDocument();
 await act(async()=>message.reject(blocked()));expect(image).not.toBeInTheDocument();expect(screen.queryByRole('img')).toBeNull();
 const count=f.request.mock.calls.length;fireEvent.load(image);fireEvent.error(image);await resume();
 expect(screen.queryByRole('button',{name:/Reintentar/})).toBeNull();expect(f.request).toHaveBeenCalledTimes(count);expect(screen.queryByRole('img')).toBeNull();
});
it('rejects an obsolete successful profile after a newer block denial',async()=>{
 const f=mount();const image=await screen.findByRole('img');const old=deferred();f.request.mockReturnValueOnce(old.promise);await resume();
 const signal=f.request.mock.calls.at(-1)![1];f.request.mockRejectedValueOnce(blocked());await resume();expect(signal.aborted).toBe(true);expect(image).not.toBeInTheDocument();
 await act(async()=>old.resolve(visualProfile()));fireEvent.load(image);fireEvent.error(image);const count=f.request.mock.calls.length;await resume();
 expect(screen.queryByRole('img')).toBeNull();expect(f.request).toHaveBeenCalledTimes(count);expect(screen.queryByRole('button',{name:/Reintentar/})).toBeNull();
});
it.each([401,403,404])('withdraws on %s but restores only after a fresh successful retry',async status=>{
 const f=mount();const image=await screen.findByRole('img');f.request.mockRejectedValueOnce(new ApiError('backend',status));await resume();expect(image).not.toBeInTheDocument();
 const fresh=deferred();f.request.mockReturnValueOnce(fresh.promise);fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await waitFor(()=>expect(f.request).toHaveBeenCalledTimes(3));expect(screen.queryByRole('img')).toBeNull();
 await act(async()=>fresh.resolve(visualProfile()));expect(await screen.findByRole('img')).not.toBe(image);
});
