const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function partsToRecord(parts: Intl.DateTimeFormatPart[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') record[part.type] = Number(part.value);
  }
  return record;
}

export function dayInTimeZone(instant: Date, timeZone: string): string {
  const { year, month, day } = partsToRecord(partsFormatter(timeZone).formatToParts(instant));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = partsToRecord(
    offsetFormatter(timeZone).formatToParts(instant),
  );
  const asUtc = Date.UTC(year, month - 1, day, hour % 24, minute, second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return next.toISOString().slice(0, 10);
}

export function zonedMidnightUtc(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const wallClock = Date.UTC(year, month - 1, date);
  let guess = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = wallClock - zoneOffsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function nextResetAt(now: Date, timeZone: string): Date {
  return zonedMidnightUtc(addDays(dayInTimeZone(now, timeZone), 1), timeZone);
}

export function secondsUntil(instant: Date, now: Date): number {
  return Math.max(1, Math.ceil((instant.getTime() - now.getTime()) / 1000));
}

export function shanghaiIso(instant: Date): string {
  const { year, month, day, hour, minute, second } = partsToRecord(
    offsetFormatter('Asia/Shanghai').formatToParts(instant),
  );
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`;
}
