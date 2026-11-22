// WhatsApp setup state for the live clinic: each patient's number, their consent, and a setup checklist.
// For now this lives on the physio's device only (localStorage). Storing numbers in the clinic's cloud needs the backend in WHATSAPP.md.
import type { AnsweredBy, Lang } from '../types';

export interface WaConsent { by: AnsweredBy; at: string; lang: Lang }
export interface WaContact { phone: string; consent: WaConsent | null; sendTime: string }
export interface WaSettings { contacts: Record<string, WaContact>; checklist: Record<string, boolean> }

export const WA_KEY = 'rehabpath-whatsapp-v1';
export const CHECKLIST: { id: string; label: string; help: string }[] = [
  { id: 'business', label: 'Meta Business account verified', help: 'Create it at business.facebook.com and complete business verification.' },
  { id: 'number', label: 'A phone number for the clinic, added to WhatsApp Business Platform', help: 'It must not already be on a normal WhatsApp account. A new SIM or a landline works.' },
  { id: 'provider', label: 'Provider chosen (Meta Cloud API directly, or a partner such as Gupshup, Twilio or Interakt)', help: 'Check the current India price per message before you decide.' },
  { id: 'templates', label: 'Message templates submitted and approved', help: 'The five templates below are ready to submit. Approval can take days.' },
  { id: 'webhook', label: 'Webhook connected to the clinic backend', help: 'See WHATSAPP.md: secrets, function deploy and webhook address.' },
  { id: 'consent', label: 'Patient consent wording reviewed (DPDP)', help: 'Take legal advice before real patients. Consent is recorded per patient below.' },
];

const empty = (): WaSettings => ({ contacts: {}, checklist: {} });

export function loadWa(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): WaSettings {
  try {
    const raw = storage?.getItem(WA_KEY);
    if (!raw) return empty();
    const j = JSON.parse(raw) as Partial<WaSettings>;
    return { contacts: j.contacts ?? {}, checklist: j.checklist ?? {} };
  } catch { return empty(); }
}
export function saveWa(s: WaSettings, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(WA_KEY, JSON.stringify(s)); } catch { /* private mode: setup is not kept */ }
}

/** Turns what a person typed into +<country code><number>, or null if it cannot be a phone number. A bare 10-digit number is taken as Indian. */
export function normalisePhone(raw: string): string | null {
  const t = raw.trim();
  const plus = t.startsWith('+');
  let d = t.replace(/\D/g, '');
  if (!d) return null;
  if (!plus) {
    if (d.length === 10) d = '91' + d;
    else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
    else if (d.length === 12 && d.startsWith('91')) { /* already has the country code */ }
    else return null;
  }
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
export const isLikelyIndianMobile = (e164: string): boolean => /^\+91[6-9]\d{9}$/.test(e164);

export const maskPhone = (e164: string): string => (e164.length > 6 ? `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 7))}${e164.slice(-4)}` : e164);
