// Date helpers shared by the server and the page. Dates are YYYY-MM-DD strings.

/** Today's date in Japan. */
export function todayInTokyo(): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'}).format(new Date())
}

/** The day after a date. */
export function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
