/** Parses "HH:MM" or "HH:MM:SS" into seconds since midnight. Returns null if unparseable. */
export function parseClockTimeToSeconds(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + s;
}

/** Formats seconds (may exceed 86400 for multi-day events) back to "HH:MM:SS", wrapped to a 24h clock. */
export function secondsToClockTime(totalSeconds: number): string {
  const wrapped = Math.round(((totalSeconds % 86400) + 86400) % 86400);
  const rolled = wrapped % 86400;
  const h = Math.floor(rolled / 3600);
  const m = Math.floor((rolled % 3600) / 60);
  const s = rolled % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
