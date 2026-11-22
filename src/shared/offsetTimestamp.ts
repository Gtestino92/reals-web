export function parseOffsetTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  const instant = Date.parse(value);
  if (!match || !Number.isFinite(instant)) return null;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour)>23 || Number(minute)>59 || Number(second ?? 0)>59 || Number(offsetHour ?? 0)>23 || Number(offsetMinute ?? 0)>59) return null;
  return instant;
}
