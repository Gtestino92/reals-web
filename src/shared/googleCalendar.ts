import { parseOffsetTimestamp } from './offsetTimestamp';

export interface CalendarEvent {
  startsAt: string;
  durationMinutes: number;
  partnerName: string | null;
}

function calendarTimestamp(instant: number): string | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().replace(/[-:]/g, '').replace(/\.000Z$/, 'Z');
}

export function googleCalendarUrl({ startsAt, durationMinutes, partnerName }: CalendarEvent): string | null {
  const start = parseOffsetTimestamp(startsAt);
  if (start === null || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) return null;
  const from = calendarTimestamp(start);
  const to = calendarTimestamp(start + durationMinutes * 60_000);
  if (!from || !to) return null;

  const name = partnerName?.trim();
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: name ? `Cita con ${name}` : 'Cita en Reals',
    dates: `${from}/${to}`,
    details: 'Segundo chat en Reals.',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
