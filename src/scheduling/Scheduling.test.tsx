import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Scheduling } from './Scheduling';
import { setup, proposal, time } from './fixtures';
import { visualProfile } from '../visual/fixtures';
import { ApiError } from '../auth/api';
function view(f=setup()) {const back=vi.fn(),browse=vi.fn(),blocked=vi.fn();const props={controller:f.controller,connectionId:'c',matchId:'m',partnerName:'María',onBack:back,onFinished:back,onBlocked:blocked,browse:false,onBrowse:browse,onCloseBrowse:back};const v=render(<Scheduling {...props}/>);return {...f,...v,props,back,browse,blocked};}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('renders selector with seven days, half hours, ordered removals and profile navigation',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});expect(screen.getByLabelText('Día').children).toHaveLength(7);expect(screen.getByLabelText('Minutos').children).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Quitar opción 1'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Ver perfil'}));expect(f.browse).toHaveBeenCalledOnce();
});
it('prioritizes received expired proposals and allows rejection before own submission',async()=>{
 const f=setup();f.state.p=[proposal({proposedDateTime:'2020-01-01T12:00:00Z'})];view(f);await screen.findByRole('heading',{name:'Horarios que recibiste'});expect(screen.queryByRole('heading',{name:'Proponé tus horarios'})).toBeNull();expect(screen.getByRole('button',{name:'Aceptar opción 1'})).toBeDisabled();expect(screen.getByRole('button',{name:'Rechazar estas opciones'})).toBeEnabled();expect(screen.getByText('Vencido')).toBeVisible();
});
it('polls every seven seconds, skips hidden polls, resumes online and preserves selected draft',async()=>{
 vi.useFakeTimers();vi.setSystemTime(time);const f=view();await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));const before=f.request.mock.calls.length;
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await act(async()=>vi.advanceTimersByTime(7000));expect(f.request.mock.calls).toHaveLength(before);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');await act(async()=>window.dispatchEvent(new Event('online')));expect(f.request.mock.calls.length).toBeGreaterThan(before);expect(screen.getByRole('button',{name:'Quitar opción 1'})).toBeVisible();
});
it('browses compact photos without decision controls and returns to preserved draft',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));const read=f.request.getMockImplementation()!;
 f.request.mockImplementation(async(path,...args)=>path.endsWith('/visual-profile')?visualProfile():read(path,...args));
 f.rerender(<Scheduling {...f.props} browse/>);await screen.findByRole('heading',{name:'María, 29'});expect(screen.queryByRole('button',{name:'Aprobar'})).toBeNull();expect(screen.getByRole('button',{name:'Ver foto 1 de 4'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'Ver foto 2 de 4'}));expect(screen.getByRole('button',{name:'Ver foto 2 de 4'})).toHaveAttribute('aria-pressed','true');f.rerender(<Scheduling {...f.props}/>);expect(screen.getByRole('button',{name:'Quitar opción 1'})).toBeVisible();
});
it('requires permanent block confirmation and serializes double click',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});fireEvent.click(screen.getByRole('button',{name:'Más acciones'}));fireEvent.click(screen.getByRole('menuitem'));expect(screen.getByRole('dialog')).toBeVisible();expect(f.request.mock.calls.some(c=>c[2]==='POST')).toBe(false);
 const read=f.request.getMockImplementation()!;f.request.mockImplementation(async(path,...args)=>path.endsWith('/block')?{id:'block'}:read(path,...args));const block=screen.getByRole('button',{name:'Bloquear definitivamente'});fireEvent.click(block);fireEvent.click(block);await waitFor(()=>expect(f.back).toHaveBeenCalledOnce());expect(f.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});
it('disables expired negotiation without inventing failure and refreshes authority',async()=>{
 const f=setup();f.state.n.schedulingExpiresAt='2020-01-01T12:00:00Z';f.state.c.schedulingExpiresAt=f.state.n.schedulingExpiresAt;view(f);await screen.findByText(/La coordinación venció/);expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeDisabled();expect(screen.queryByText(/No hubo acuerdo/)).toBeNull();
});
it('shows transient availability errors and retries safely',async()=>{
 const f=setup();f.request.mockRejectedValueOnce(new ApiError('network'));view(f);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByRole('heading',{name:'Proponé tus horarios'});expect(screen.getByRole('button',{name:'Agregar opción'})).toBeEnabled();
});

it('keeps picker, submit, profile and block responsive during a slow background poll without loading flicker',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});const read=f.request.getMockImplementation()!;let resolve!:(v:unknown)=>void;
 f.request.mockReturnValueOnce(new Promise(r=>{resolve=r;}));act(()=>window.dispatchEvent(new Event('online')));
 fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeEnabled();expect(screen.getByRole('button',{name:'Ver perfil'})).toBeEnabled();
 expect(screen.queryByText(/Actualizando/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Más acciones'}));fireEvent.click(screen.getByRole('menuitem'));expect(screen.getByRole('button',{name:'Bloquear definitivamente'})).toBeEnabled();
 await act(async()=>resolve(await read('/connections/c',new AbortController().signal)));
});
