import type { Patient } from './types';

const q = (v: unknown): string => {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  // Quote everything and neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The audit log as CSV: one row per plan change, oldest first. Includes the physio's reason. */
export function auditCsv(p: Patient): string {
  const head = ['When (ISO)', 'Patient', 'Who', 'Physio-initiated', 'Action', 'What changed', 'Reason'];
  const rows = p.audit.map((a) => [a.at, p.name, a.who, a.manual ? 'yes' : 'no', a.action, a.summary, a.note ?? '']);
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
