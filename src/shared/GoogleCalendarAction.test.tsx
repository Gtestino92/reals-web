import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoogleCalendarAction } from './GoogleCalendarAction';
import { calendarOpenedKey, pruneCalendarOpened } from './calendarOpened';

const now = Date.parse('2026-11-15T12:00:00Z');
const startsAt = '2026-11-15T16:00:00Z';
const props = { event:{startsAt,durationMinutes:75,partnerName:'María'}, accountId:'me', connectionId:'connection', now:()=>now };
const openLabel = 'Agregar a Google Calendar';
const retryLabel = 'Volver a agregar al calendario';
const openedStatus = 'Evento abierto en Google Calendar';
const key = (accountId = props.accountId, connectionId = props.connectionId, start = startsAt) =>
  calendarOpenedKey(accountId, connectionId, start)!;

beforeEach(()=>localStorage.clear());
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});

it('retains the opened marker across remounts without storing event details', () => {
  const first=render(<GoogleCalendarAction {...props}/>);
  const link=screen.getByRole('link',{name:openLabel});
  expect(localStorage.length).toBe(0);
  expect(screen.queryByText(openedStatus)).toBeNull();
  link.focus();
  expect(fireEvent.click(link)).toBe(true);
  expect(link).toHaveFocus();
  expect(localStorage.getItem(key())).toBe('1');
  expect(Object.keys(localStorage)).toEqual([key()]);
  expect(key()).not.toMatch(/María|calendar\.google\.com/);
  const href=link.getAttribute('href');
  first.unmount();
  render(<GoogleCalendarAction {...props}/>);
  expect(screen.getByText(openedStatus)).toBeVisible();
  expect(screen.getByRole('link',{name:retryLabel})).toHaveAttribute('href',href);
});

it('synchronizes marks and clearing from another localStorage document', () => {
  render(<GoogleCalendarAction {...props}/>);
  act(()=>{
    localStorage.setItem(key(),'1');
    window.dispatchEvent(new StorageEvent('storage',{key:key(),newValue:'1',storageArea:localStorage}));
  });
  expect(screen.getByRole('link',{name:retryLabel})).toBeVisible();
  act(()=>{
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage',{key:null,storageArea:localStorage}));
  });
  expect(screen.getByRole('link',{name:openLabel})).toBeVisible();
});

it('scopes markers to the user, connection and instant, normalizing equivalent offsets', () => {
  const view=render(<GoogleCalendarAction {...props}/>);
  fireEvent.click(screen.getByRole('link',{name:openLabel}));
  view.rerender(<GoogleCalendarAction {...props} accountId="partner"/>);
  expect(screen.getByRole('link',{name:openLabel})).toBeVisible();
  view.rerender(<GoogleCalendarAction {...props} connectionId="other"/>);
  expect(screen.getByRole('link',{name:openLabel})).toBeVisible();
  view.rerender(<GoogleCalendarAction {...props} event={{...props.event,startsAt:'2026-11-15T17:00:00Z'}}/>);
  expect(screen.getByRole('link',{name:openLabel})).toBeVisible();
  view.rerender(<GoogleCalendarAction {...props} event={{...props.event,startsAt:'2026-11-15T13:00:00-03:00'}}/>);
  expect(screen.getByRole('link',{name:retryLabel})).toBeVisible();
});

it('uses an in-memory marker when storage is blocked and preserves navigation', () => {
  const inaccessible=vi.spyOn(window,'localStorage','get').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});
  render(<GoogleCalendarAction {...props} connectionId="inaccessible"/>);
  expect(fireEvent.click(screen.getByRole('link',{name:openLabel}))).toBe(true);
  expect(screen.getByText(openedStatus)).toBeVisible();
  inaccessible.mockRestore();
  expect(fireEvent.click(screen.getByRole('link',{name:retryLabel}))).toBe(true);
  expect(localStorage.getItem(key('me','inaccessible'))).toBe('1');
});

it('cleans malformed and expired markers and bounds future markers within its namespace', () => {
  const expired=key('me','expired','2026-11-15T11:00:00Z');
  const malformed='reals:calendar-opened:v1:invalid';
  localStorage.setItem(expired,'1');
  localStorage.setItem(malformed,'1');
  localStorage.setItem(key(),'garbage');
  localStorage.setItem('other-feature','keep');
  render(<GoogleCalendarAction {...props}/>);
  expect(screen.getByRole('link',{name:openLabel})).toBeVisible();
  expect(Object.keys(localStorage)).toEqual(['other-feature']);
  for(let index=0;index<105;index++){
    localStorage.setItem(key('me',`c${index}`,new Date(now+60_000*(index+1)).toISOString()),'1');
  }
  pruneCalendarOpened(now);
  expect(localStorage.length).toBe(101);
  expect(localStorage.getItem('other-feature')).toBe('keep');
});

it('marks a middle-click activation but ignores a right-click', () => {
  render(<GoogleCalendarAction {...props}/>);
  const link=screen.getByRole('link',{name:openLabel});
  fireEvent(link,new MouseEvent('auxclick',{button:2,bubbles:true,cancelable:true}));
  expect(screen.queryByText(openedStatus)).toBeNull();
  expect(fireEvent(link,new MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true}))).toBe(true);
  expect(screen.getByText(openedStatus)).toBeVisible();
});
