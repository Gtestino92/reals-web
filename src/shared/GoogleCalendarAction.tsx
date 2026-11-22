import { useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import { calendarOpenedKey, calendarWasOpened, markCalendarOpened, pruneCalendarOpened, subscribeCalendarOpened } from './calendarOpened';
import { googleCalendarUrl, type CalendarEvent } from './googleCalendar';
import './google-calendar.css';

export function GoogleCalendarAction({ event, accountId, connectionId, now = Date.now }: {
  event: CalendarEvent; accountId: string; connectionId: string; now?: () => number;
}) {
  const href = googleCalendarUrl(event);
  const key = href ? calendarOpenedKey(accountId, connectionId, event.startsAt) : null;
  const opened = useSyncExternalStore(subscribeCalendarOpened, () => calendarWasOpened(key), () => false);
  useEffect(() => { if (key) pruneCalendarOpened(now()); }, [key, now]);
  if (!href) return null;

  const activate = (click: MouseEvent<HTMLAnchorElement>) => {
    const currentTime = now();
    if (Date.parse(event.startsAt) <= currentTime) {
      click.preventDefault();
      return;
    }
    if (!click.defaultPrevented && key) markCalendarOpened(key, currentTime);
  };

  return <div className="google-calendar">
    <span className="google-calendar-status" role="status">{opened ? 'Evento abierto en Google Calendar' : ''}</span>
    <a className={`login-button google-calendar-action ${opened ? 'google-calendar-reopen' : 'login-outlined'}`}
      href={href} target="_blank" rel="noopener noreferrer"
      onClick={activate} onAuxClick={e => { if (e.button === 1) activate(e); }}>
      {!opened && <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="5" width="18" height="16" rx="2"/>
        <path d="M7 3v4m10-4v4M3 10h18"/>
      </svg>}
      {opened ? 'Volver a agregar al calendario' : 'Agregar a Google Calendar'}
    </a>
  </div>;
}
