import { DateTime } from 'luxon';

export const localDateTimeToUtcIso = (
  localDate: string,
  localTime: string,
  timezone: string,
): string => {
  const local = DateTime.fromISO(`${localDate}T${localTime}`, { zone: timezone });
  if (!local.isValid) {
    throw new Error(`Invalid local datetime ${localDate} ${localTime} in ${timezone}`);
  }

  return local.toUTC().toISO({ suppressMilliseconds: true }) ?? '';
};

export const utcToLocationString = (
  utcIso: string,
  timezone: string,
  format = "ccc, LLL d 'at' t",
): string => {
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) {
    throw new Error(`Invalid UTC datetime: ${utcIso}`);
  }

  return dt.toFormat(format);
};

export const computeWeekStart = (dateIso: string, timezone: string): string => {
  const localDay = DateTime.fromISO(dateIso, { zone: timezone }).startOf('day');
  if (!localDay.isValid) {
    throw new Error(`Invalid date for week start: ${dateIso}`);
  }

  const mondayOffset = localDay.weekday - 1;
  return localDay.minus({ days: mondayOffset }).toISODate() ?? '';
};

export const resolveShiftUtcWindow = (args: {
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  timezone: string;
}): { startAtUtc: string; endAtUtc: string; overnight: boolean } => {
  const start = DateTime.fromISO(`${args.localDate}T${args.startLocalTime}`, {
    zone: args.timezone,
  });
  let end = DateTime.fromISO(`${args.localDate}T${args.endLocalTime}`, {
    zone: args.timezone,
  });

  if (!start.isValid || !end.isValid) {
    throw new Error('Invalid shift time data');
  }

  let overnight = false;
  if (end <= start) {
    end = end.plus({ days: 1 });
    overnight = true;
  }

  return {
    startAtUtc: start.toUTC().toISO({ suppressMilliseconds: true }) ?? '',
    endAtUtc: end.toUTC().toISO({ suppressMilliseconds: true }) ?? '',
    overnight,
  };
};

export const hoursUntilUtc = (utcIso: string): number => {
  const target = DateTime.fromISO(utcIso, { zone: 'utc' });
  const now = DateTime.utc();
  return target.diff(now, 'hours').hours;
};