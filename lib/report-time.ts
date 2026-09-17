/** Store a timestamp with an explicit Mountain offset, including daylight saving. */
export function edmontonTimestamp(date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName.replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
