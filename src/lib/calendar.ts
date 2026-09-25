/**
 * A calendar day typed by a person or exported by a bank, as `YYYY-MM-DD`.
 *
 * `17/03/2026` and `17-03-2026` mean the same day, and neither is ISO.
 * Day-first rather than month-first, deliberately: this ledger's users are in
 * Vietnam, Australia and Europe, where 03/04 is the third of April. Japanese
 * banks export year-first — `2026/03/17` — which is unambiguous and read as
 * such. Ambiguous dates are why every importer prints the resolved date back:
 * a person reading "2026-04-03" beside their own row will notice if it is
 * wrong, and cannot notice anything if the import only echoes what they typed.
 *
 * Returns the empty string for anything that is not a real day.
 */
export function normaliseDate(value: string): string {
  const trimmed = value.trim();
  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/u.exec(trimmed);
  if (yearFirst) return calendarDay(yearFirst[1] ?? '', yearFirst[2] ?? '', yearFirst[3] ?? '');

  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:$|\s)/u.exec(trimmed);
  if (dayFirst) {
    const [, day = '', month = '', year = ''] = dayFirst;
    return calendarDay(year, month, day);
  }

  return '';
}

/**
 * `YYYY-MM-DD` if that day exists, or nothing.
 *
 * Round-tripped rather than parsed: `Date.parse('2026-02-30')` answers 2 March
 * instead of refusing, so a typo was booked on a different day from the one
 * the preview showed — and month 13 passed the preview only to throw on
 * import.
 */
export function calendarDay(year: string, month: string, day: string): string {
  const padded = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === padded ? padded : '';
}
