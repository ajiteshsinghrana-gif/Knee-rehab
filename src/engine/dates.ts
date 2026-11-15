// Date helpers on YYYY-MM-DD strings (UTC, no timezone surprises).
const MS = 86_400_000;
export const toMs = (d: string): number => Date.parse(d + 'T00:00:00Z');
export const addDays = (d: string, n: number): string => new Date(toMs(d) + n * MS).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string): number => Math.round((toMs(a) - toMs(b)) / MS);
