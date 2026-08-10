/**
 * Date and time formatting for club headers.
 *
 * Everything is treated as UTC-at-noon on purpose. A club's date is a plain
 * calendar day ("2026-08-10"), not an instant — parsing it at midnight would
 * let a build machine in a negative-offset timezone render it as the 9th.
 */

const ORDINALS = { 1: 'st', 2: 'nd', 3: 'rd', 21: 'st', 22: 'nd', 23: 'rd', 31: 'st' };

export const ordinal = (day) => ORDINALS[day] ?? 'th';

/** "2026-08-10" → Date at 2026-08-10T12:00:00Z */
export function parseDay(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

/** "2026-08-10" → "Monday 10th August 2026" */
export function dateLabel(iso) {
  const date = parseDay(iso);
  const day = date.getUTCDate();
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${weekday} ${day}${ordinal(day)} ${month} ${date.getUTCFullYear()}`;
}

/**
 * "11:00" + "11:45" → "11:00–11:45" (en dash).
 * Tolerates a missing end time, since a session occasionally overruns and
 * nobody writes it down.
 */
export function timeLabel(start, end) {
  if (!start && !end) return '';
  if (!end) return start;
  if (!start) return end;
  return `${start}–${end}`;
}
