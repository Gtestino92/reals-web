import { expect, it } from 'vitest';
import { googleCalendarUrl } from './googleCalendar';

const event = { startsAt: '2026-11-01T01:30:00-04:00', durationMinutes: 75, partnerName: '  María & Zoë + 東京 / #?  ' };

it('encodes only the prefilled event fields and adds elapsed minutes across DST', () => {
  const url = new URL(googleCalendarUrl(event)!);
  expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    action: 'TEMPLATE',
    text: 'Cita con María & Zoë + 東京 / #?',
    dates: '20261101T053000Z/20261101T064500Z',
    details: 'Segundo chat en Reals.',
  });
});

it.each([null, '  '])('uses a neutral title when the name is unavailable (%s)', partnerName => {
  const url = new URL(googleCalendarUrl({ ...event, startsAt: '2026-04-05T01:30:00+10:30', partnerName })!);
  expect(url.searchParams.get('text')).toBe('Cita en Reals');
  expect(url.searchParams.get('dates')).toBe('20260404T150000Z/20260404T161500Z');
});

it.each(['', 'unknown', '2026-02-30T04:00:00Z', '2026-05-01T04:00:00', '2026-05-01T24:00:00Z'])(
  'rejects a missing or invalid confirmed instant (%s)',
  startsAt => expect(googleCalendarUrl({ ...event, startsAt })).toBeNull(),
);

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
  'rejects an invalid or unrepresentable duration (%s)',
  durationMinutes => expect(googleCalendarUrl({ ...event, durationMinutes })).toBeNull(),
);
