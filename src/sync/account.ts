/**
 * Patient accounts (Phase 6.3). A patient makes an email-and-password account the first time they open their invite link.
 * The account claims that one patient and stores the invite, so the patient can sign in on any phone and get the plan back.
 * Everything here takes its server and storage as arguments so tests can drive it without a browser.
 */
import type { Patient, ProtocolPack } from '../types';
import { decodeInvite, encodeInvite } from '../onboarding';
import { claimPatient, listPatientLinks, type FetchFn, type SyncConfig } from './client';
import { getAccessToken, signIn, signUp } from './auth';

type Store = Parameters<typeof signIn>[4];

/** Sign up and claim this patient. Returns 'confirm-email' when the project asks the email to be confirmed first (nothing is claimed yet). */
export async function createPatientAccount(c: SyncConfig, patient: Patient, email: string, password: string, fetchFn: FetchFn = fetch, store?: Store, nowMs = Date.now(), pin?: string): Promise<'done' | 'confirm-email'> {
  if (!patient.syncKey) throw new Error('This link has no sync key, so an account cannot be linked to it');
  let r: 'signed-in' | 'confirm-email';
  try { r = await signUp(c, email.trim(), password, fetchFn, store, nowMs); }
  catch (e) {
    // A retry after a wrong PIN: the login was made the first time, so sign in with the same password and claim again.
    if (!/already registered|already been registered/i.test((e as Error).message)) throw e;
    await signIn(c, email.trim(), password, fetchFn, store, nowMs);
    r = 'signed-in';
  }
  if (r === 'confirm-email') return 'confirm-email';
  const token = await getAccessToken(c, fetchFn, store, nowMs);
  if (!token) throw new Error('Could not sign in after creating the account');
  await claimPatient(c, patient.syncKey, encodeInvite(patient), token, fetchFn, pin);
  return 'done';
}

export interface Restored { patients: Patient[]; packs: ProtocolPack[] }

/** Sign in, then return this account's patients rebuilt from their stored invites. If `current` (the link just opened) is not yet
 *  this account's, it is claimed first, so a patient who already has an account can add a second link. */
export async function signInPatient(c: SyncConfig, email: string, password: string, current?: Patient, fetchFn: FetchFn = fetch, store?: Store, nowMs = Date.now(), pin?: string): Promise<Restored> {
  await signIn(c, email.trim(), password, fetchFn, store, nowMs);
  const token = await getAccessToken(c, fetchFn, store, nowMs);
  if (!token) throw new Error('Could not sign in');
  let links = await listPatientLinks(c, token, fetchFn);
  if (current?.syncKey && !links.some((l) => l.sync_key === current.syncKey)) {
    await claimPatient(c, current.syncKey, encodeInvite(current), token, fetchFn, pin);
    links = await listPatientLinks(c, token, fetchFn);
  }
  const patients: Patient[] = [];
  const packs: ProtocolPack[] = [];
  for (const l of links) {
    const d = decodeInvite(l.invite);
    if (!d) continue;
    patients.push({ ...d.patient, accountEmail: email.trim() });
    if (d.pack) packs.push(d.pack);
  }
  return { patients, packs };
}
