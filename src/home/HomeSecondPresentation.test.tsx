import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { secondHomePresentation, secondHomeCopy, contextualTime } from './secondHomePresentation';
import { homeSecondFixture } from './secondHome.fixtures';
import { SecondChatCard } from './SecondChatCard';
import { HomePriorities } from './HomePriorities';
import { activityPresentation } from './presentation';
import { useHomeTime } from './useHomeTime';
import type { HomeData } from './contracts';
const at=(time:string)=>Date.parse(`2026-11-13T${time}Z`);
const home=(items= [homeSecondFixture()]):HomeData=>({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},summary:{activeInitialCount:0,activeConnectionCount:1,actionableConnectionCount:1,hasPendingSchedulingConnection:false},pendingActions:[],nextSteps:items,passiveNotices:[]});
afterEach(()=>{vi.useRealTimers();localStorage.clear();});
it.each(['PENDING','NO_SHOW','ON_TIME','LATE'])('separates entry and absolute expiry for attendance %s at exact boundaries',attendance=>{
 const item=homeSecondFixture(),s=item.secondChat!;s.myAttendanceStatus=attendance;if(['ON_TIME','LATE'].includes(attendance)){s.chatId='c';s.chatStatus='ACTIVE';}
 const joined=['ON_TIME','LATE'].includes(attendance),original=JSON.stringify(item);
 for(const [now,canOpen]of [[at('11:59:59'),joined],[at('12:00:00'),true],[Date.parse(s.entryClosesAt)-1,true],[Date.parse(s.entryClosesAt),joined],[Date.parse(s.expiresAt)-1,joined],[Date.parse(s.expiresAt),false]] as const){expect(secondHomePresentation(item,now)?.canOpen).toBe(canOpen);}
 expect(JSON.stringify(item)).toBe(original);
});
it.each(['FINISHED','ABANDONED','EXPIRED'])('retains backend %s read-only policy before/at retention cutoff',chatStatus=>{const item=homeSecondFixture();item.type='SECOND_CHAT_READ_ONLY';Object.assign(item.secondChat!,{chatId:'c',chatStatus,readOnlyUntil:'2026-11-13T15:00:00Z'});expect(secondHomePresentation(item,at('14:59:59'))).toMatchObject({state:'ReadOnly',canOpen:true,canProfile:false,canDismiss:true});expect(secondHomePresentation(item,at('15:00:00'))).toMatchObject({state:'ReadOnlyEnded',canOpen:false,canDismiss:true});});
it.each(['CANCELLED','CLOSED','FINISHED','ABANDONED','EXPIRED'])('does not open a stale available item whose chat is actually %s',chatStatus=>{const item=homeSecondFixture();item.type='SECOND_CHAT_AVAILABLE';Object.assign(item.secondChat!,{chatId:'c',chatStatus,myAttendanceStatus:'ON_TIME'});expect(secondHomePresentation(item,at('12:10:00'))).toMatchObject({canOpen:false,canProfile:false,canDismiss:true});expect(activityPresentation(home([item]),at('12:10:00')).priorities).toHaveLength(0);});
it('does not guess a punctuality threshold absent from Home metadata',()=>{const item=homeSecondFixture();const serverOnlyBoundary=at('12:07:00');expect(secondHomePresentation(item,serverOnlyBoundary-1)).toEqual(secondHomePresentation(item,serverOnlyBoundary));expect(secondHomeCopy(item,serverOnlyBoundary)).not.toMatch(/tarde|a tiempo/);});
it('promotes stale scheduled snapshots at start and withdraws priority at unjoined cutoff',()=>{const item=homeSecondFixture(),original=JSON.stringify(item);expect(activityPresentation(home([item]),at('11:44:59')).priorities).toHaveLength(0);expect(activityPresentation(home([item]),at('11:45:00')).priorities).toEqual([item]);expect(activityPresentation(home([item]),at('12:00:00')).priorities).toEqual([item]);expect(activityPresentation(home([item]),at('12:19:00')).priorities).toHaveLength(0);expect(JSON.stringify(item)).toBe(original);});
it('orders priority by Android event and keeps First Chat in its existing group',()=>{const open=homeSecondFixture();open.matchId='open';open.secondChat!.expiresAt='2026-11-13T14:00:00Z';const soon=homeSecondFixture();soon.matchId='soon';soon.secondChat!.availableAt='2026-11-13T12:15:00Z';const other=homeSecondFixture();other.matchId='other';other.secondChat!.availableAt='2026-11-13T12:14:00Z';const data=home([open,soon,other]);data.pendingActions=[{...homeSecondFixture(),type:'FIRST_CHAT',chatId:'first'}];const view=activityPresentation(data,at('12:00:00'));expect(view.priorities.map(i=>i.matchId)).toEqual(['other','soon']);expect(view.priorityOverflow).toBe(1);expect(view.groups.find(g=>g.title==='En curso')?.items.some(i=>i.type==='FIRST_CHAT')).toBe(true);});
it('uses direct authorized priority action, Activity for starting soon, and disables all actions while busy',()=>{vi.useFakeTimers();vi.setSystemTime(at('11:50:00'));const soon=homeSecondFixture(),onOpen=vi.fn(),onActivity=vi.fn();const view=render(<HomePriorities items={[soon]} overflow={1} now={Date.now()} disabled={false} onOpen={onOpen} onActivity={onActivity}/>);fireEvent.click(screen.getByRole('button',{name:/Ver en Actividad/}));expect(onActivity).toHaveBeenCalledOnce();expect(onOpen).not.toHaveBeenCalled();vi.setSystemTime(at('12:00:00'));view.rerender(<HomePriorities items={[soon]} overflow={0} now={Date.now()} disabled={false} onOpen={onOpen} onActivity={onActivity}/>);fireEvent.click(screen.getByRole('button',{name:/Entrar al chat/}));expect(onOpen).toHaveBeenCalledWith(soon);view.rerender(<HomePriorities items={[soon]} overflow={1} now={Date.now()} disabled={true} onOpen={onOpen} onActivity={onActivity}/>);for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();});
it('rechecks priority deadline on click even before the next timer render',()=>{vi.useFakeTimers();vi.setSystemTime(at('12:18:59'));const item=homeSecondFixture(),onOpen=vi.fn();render(<HomePriorities items={[item]} overflow={0} now={Date.now()} disabled={false} onOpen={onOpen} onActivity={vi.fn()}/>);const action=screen.getByRole('button',{name:/Entrar al chat/});vi.setSystemTime(at('12:19:00'));fireEvent.click(action);expect(onOpen).not.toHaveBeenCalled();});
it.each(['ON_TIME','LATE'])('renders joined %s copy and access after cutoff without showing total duration as entry deadline',attendance=>{vi.useFakeTimers();vi.setSystemTime(at('12:20:00'));const item=homeSecondFixture();Object.assign(item.secondChat!,{myAttendanceStatus:attendance,chatId:'c',chatStatus:'ACTIVE'});render(<SecondChatCard accountId="me" item={item} disabled={false} onOpen={vi.fn()} onDismiss={vi.fn(async()=>{})}/>);expect(screen.getByRole('button',{name:'Entrar al segundo chat'})).toBeEnabled();expect(screen.queryByText(/Llegaste/)).toBeNull();expect(screen.queryByText(/Entrada permitida/)).not.toBeInTheDocument();expect(screen.queryByText(/El chat termina/)).toBeNull();expect(screen.getByText(/^Disponible desde/)).toBeVisible();expect(screen.queryByText(/^En curso desde/)).not.toBeInTheDocument();});
it('keeps concise Android card copy and disables stale unjoined entry on resume',()=>{vi.useFakeTimers();vi.setSystemTime(at('12:18:59'));const onOpen=vi.fn();render(<SecondChatCard accountId="me" item={homeSecondFixture()} disabled={false} onOpen={onOpen} onDismiss={vi.fn(async()=>{})}/>);expect(screen.queryByText(/Entrada permitida hasta/)).toBeNull();expect(screen.queryByText(/El chat termina/)).toBeNull();const action=screen.getByRole('button',{name:'Entrar al segundo chat'});vi.setSystemTime(at('12:19:00'));fireEvent.click(action);expect(onOpen).not.toHaveBeenCalled();act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(screen.queryByRole('button',{name:'Entrar al segundo chat'})).not.toBeInTheDocument();expect(screen.getByText('La ventana para entrar terminó.')).toBeVisible();});
it('refreshes the shared presentation clock on resume and releases timers/listeners',()=>{vi.useFakeTimers();vi.setSystemTime(at('11:59:59'));const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');const {result,unmount}=renderHook(()=>useHomeTime());vi.setSystemTime(at('12:19:00'));act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(result.current).toBe(at('11:59:59'));visibility.mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(result.current).toBe(at('12:19:00'));unmount();expect(vi.getTimerCount()).toBe(0);});
it('formats contextual backend dates without an invented entry/attendance boundary',()=>{const now=new Date(2026,10,13,10).getTime(),today=new Date(2026,10,13,18).toISOString(),tomorrow=new Date(2026,10,14,18).toISOString();expect(contextualTime(today,now)).toMatch(/^Hoy,/);expect(contextualTime(tomorrow,now)).toMatch(/^Mañana,/);});
it('shows read-only retention copy without an entry or new attendance claim',()=>{vi.useFakeTimers();vi.setSystemTime(at('14:10:00'));const item=homeSecondFixture();item.type='SECOND_CHAT_READ_ONLY';Object.assign(item.secondChat!,{chatId:'c',chatStatus:'FINISHED',readOnlyUntil:'2026-11-13T15:00:00Z'});render(<SecondChatCard accountId="me" item={item} disabled={false} onOpen={vi.fn()} onDismiss={vi.fn(async()=>{})}/>);expect(screen.getByRole('button',{name:'Ver segundo chat'})).toBeEnabled();expect(screen.getByText(/Disponible solo para lectura hasta/)).toBeVisible();expect(screen.queryByText(/Entrada permitida/)).not.toBeInTheDocument();});

it('does not expose direct entry for an unknown backend chat status',()=>{const item=homeSecondFixture();item.secondChat!.chatStatus='FUTURE';expect(secondHomePresentation(item,at('12:01:00'))).toMatchObject({state:'Unavailable',canOpen:false,canDismiss:false});expect(activityPresentation(home([item]),at('12:01:00')).priorities).toHaveLength(0);});

it('offers a safe Calendar template only while waiting, with a retry after opening', () => {
  vi.useFakeTimers();
  vi.setSystemTime(at('11:59:59'));
  const item = homeSecondFixture();
  item.secondChat!.durationMinutes = 75;
  const props = { item, accountId:'me', disabled:false, onOpen:vi.fn(), onDismiss:vi.fn(async()=>{}) };
  const view = render(<SecondChatCard {...props}/>);
  const link = screen.getByRole('link', { name:'Agregar a Google Calendar' });
  expect(screen.queryByText('Evento abierto en Google Calendar')).toBeNull();
  expect(link).toHaveAttribute('target','_blank');
  expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(link).toHaveAttribute('href',expect.stringContaining('20261113T120000Z%2F20261113T131500Z'));
  const click = new MouseEvent('click', { bubbles:true, cancelable:true });
  expect(fireEvent(link,click)).toBe(true);
  expect(props.onOpen).not.toHaveBeenCalled();
  expect(props.onDismiss).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Evento abierto en Google Calendar');
  const retry = screen.getByRole('link', { name:'Volver a agregar al calendario' });
  expect(retry).toBe(link);
  expect(fireEvent.click(retry)).toBe(true);
  expect(retry).toHaveAttribute('href',expect.stringContaining('20261113T120000Z%2F20261113T131500Z'));
  view.rerender(<SecondChatCard {...props} disabled/>);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('Evento abierto en Google Calendar')).toBeNull();
  view.rerender(<SecondChatCard {...props}/>);
  vi.setSystemTime(at('12:00:00'));
  expect(fireEvent.click(screen.getByRole('link'))).toBe(false);
  act(()=>{vi.advanceTimersByTime(1000);});
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('Evento abierto en Google Calendar')).toBeNull();
  expect(screen.getByRole('button',{name:'Entrar al segundo chat'})).toBeEnabled();
});

it.each(['SECOND_CHAT_AVAILABLE','SECOND_CHAT_READ_ONLY','SECOND_CHAT_EXPIRED'])('has no Calendar link for %s', type => {
  vi.useFakeTimers();
  vi.setSystemTime(at('11:59:59'));
  render(<SecondChatCard accountId="me" item={{...homeSecondFixture(),type}} disabled={false} onOpen={vi.fn()} onDismiss={vi.fn(async()=>{})}/>);
  expect(screen.queryByRole('link')).toBeNull();
});

it.each(['AVAILABLE','ACTIVE','CANCELLED','CLOSED','FINISHED','ABANDONED','EXPIRED'])('hides a stale scheduled Calendar link when chat status is %s', chatStatus => {
  vi.useFakeTimers();
  vi.setSystemTime(at('11:59:59'));
  const item=homeSecondFixture();
  item.secondChat!.chatStatus=chatStatus;
  render(<SecondChatCard accountId="me" item={item} disabled={false} onOpen={vi.fn()} onDismiss={vi.fn(async()=>{})}/>);
  expect(screen.queryByRole('link')).toBeNull();
});
