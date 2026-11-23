/** Clinic working hours (fix phase 4): response deadlines can count only the hours the clinic is open. */
export interface WorkingHours {
  /** "09:00" and "18:00", local time on the physio's device. */
  start: string;
  end: string;
  /** Open days, 0 = Sunday ... 6 = Saturday. */
  days: number[];
}

const mins = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export const validHours = (w: WorkingHours | undefined): w is WorkingHours =>
  !!w && mins(w.end) > mins(w.start) && w.days.length > 0 && w.days.every((d) => d >= 0 && d <= 6);

/** The moment `hours` of open time have passed after `startMs`. Closed time (nights, closed days) does not count. */
export function addWorkingHours(startMs: number, hours: number, w: WorkingHours): number {
  if (!validHours(w)) return startMs + hours * 3_600_000;
  let left = hours * 60; // minutes still to count
  const t = new Date(startMs);
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const dayStart = new Date(t); dayStart.setHours(0, 0, 0, 0);
    const open = dayStart.getTime() + mins(w.start) * 60_000;
    const close = dayStart.getTime() + mins(w.end) * 60_000;
    if (w.days.includes(t.getDay()) && t.getTime() < close) {
      const from = Math.max(t.getTime(), open);
      const avail = (close - from) / 60_000;
      if (avail >= left) return from + left * 60_000;
      left -= avail;
    }
    t.setTime(dayStart.getTime()); t.setDate(t.getDate() + 1); // next day, midnight
  }
  return t.getTime();
}
