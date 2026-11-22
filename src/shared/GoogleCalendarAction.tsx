import { googleCalendarUrl, type CalendarEvent } from './googleCalendar';
import './google-calendar.css';

export function GoogleCalendarAction({ event, now = Date.now }: { event: CalendarEvent; now?: () => number }) {
  const href = googleCalendarUrl(event);
  if (!href) return null;

  return <a className="login-button login-outlined google-calendar-action" href={href} target="_blank" rel="noopener noreferrer"
    onClick={e => { if (Date.parse(event.startsAt) <= now()) e.preventDefault(); }}
    onAuxClick={e => { if (Date.parse(event.startsAt) <= now()) e.preventDefault(); }}>
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <path d="M7 3v4m10-4v4M3 10h18"/>
    </svg>
    Agregar a Google Calendar
  </a>;
}
