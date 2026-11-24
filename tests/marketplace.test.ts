import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { SCREENING_PACK, flagsForArea, screen, validateAnswers, validateScreeningPack, type ScreeningAnswers } from '../src/marketplace/screening';
import { DEMO_PHYSIOS, slotsFor } from '../src/marketplace/physios';
import { matchPhysios, type Prefs } from '../src/marketplace/match';
import { FEE_CONFIG, splitFee } from '../src/marketplace/fees';
import { bookSlot, cleanPhone, decideVerification, emptyMp, markEnrolled, registerPhysio, revenue, setBookingStatus, takenSlots, type MpState } from '../src/marketplace/ledger';
import { loadMp, seedMp } from '../src/marketplace/store';
import { enrolInRehabPath } from '../src/marketplace/handoff';
import { seedState } from '../src/store';

const TODAY = '2026-11-25'; // a Wednesday
const base: ScreeningAnswers = { area: 'back', duration: 'lt2w', severity: 2, function: 'none', recentSurgery: false, priorEpisodes: false, flags: [] };
const a = (o: Partial<ScreeningAnswers>): ScreeningAnswers => ({ ...base, ...o });
const prefs: Prefs = { mode: 'any', locality: 'Karol Bagh', maxFee: null, language: 'en' };
const mp = (): MpState => seedMp(false);
const ok = <T extends { ok: boolean }>(r: T) => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

describe('screening pack', () => {
  it('passes its own validator', () => { expect(validateScreeningPack(SCREENING_PACK)).toEqual([]); });
  it('every rule carries a source tag and Hindi wording', () => {
    for (const r of SCREENING_PACK.rules) { expect(r.source.length > 0).toBe(true); expect(r.why.hi.length > 0).toBe(true); }
  });
  it('the validator rejects a rule with no source tag, a red flag with no urgency, and an unknown flag', () => {
    const bad = JSON.parse(JSON.stringify(SCREENING_PACK));
    bad.rules[0].source = ''; delete bad.rules[3].urgency; bad.rules[1].when = { flag: 'nope' };
    const e = validateScreeningPack(bad).join(' | ');
    expect(e).toMatch('R1 has no source tag'); expect(e).toMatch('R4 is a red flag with no urgency'); expect(e).toMatch('unknown flag nope');
  });
  it('the validator rejects missing Hindi', () => {
    const bad = JSON.parse(JSON.stringify(SCREENING_PACK)); bad.areas[0].label.hi = '';
    expect(validateScreeningPack(bad).join(' ')).toMatch('label back');
  });
});

describe('screening tiers', () => {
  it('a mild, recent, unrestricted problem is low risk', () => {
    const r = screen(a({})); expect(r.tier).toBe('LOW_RISK'); expect(r.triggered).toEqual([]);
  });
  it('persistent, painful or limiting problems go to a physio assessment, with the rule that raised it', () => {
    expect(screen(a({ duration: '2to6w' })).triggered.map((t) => t.id)).toEqual(['P1']);
    expect(screen(a({ severity: 5 })).tier).toBe('PHYSIO');
    expect(screen(a({ function: 'some' })).tier).toBe('PHYSIO');
    expect(screen(a({ recentSurgery: true })).tier).toBe('PHYSIO');
    expect(screen(a({ area: 'sports' })).tier).toBe('PHYSIO');
    expect(screen(a({ priorEpisodes: true, severity: 3 })).triggered.map((t) => t.id)).toEqual(['P6']);
    expect(screen(a({ priorEpisodes: true, severity: 2 })).tier).toBe('LOW_RISK');
  });
  it('bladder or bowel trouble with back pain is an emergency', () => {
    const r = screen(a({ flags: ['bladderBowel'] })); expect(r.tier).toBe('RED_FLAG'); expect(r.urgency).toBe('now');
  });
  it('chest symptoms and stroke-like neck symptoms are emergencies', () => {
    expect(screen(a({ flags: ['chestSymptoms'] })).urgency).toBe('now');
    expect(screen(a({ area: 'neck', flags: ['neuroNeck'] })).urgency).toBe('now');
  });
  it('other warning signs mean a doctor first, within 24 hours', () => {
    for (const f of ['weakness', 'feverHotJoint', 'cancerWeightLoss']) { const r = screen(a({ flags: [f] })); expect([r.tier, r.urgency]).toEqual(['RED_FLAG', 'soon']); }
    expect(screen(a({ area: 'knee', flags: ['calfSwelling'] })).urgency).toBe('soon');
    expect(screen(a({ area: 'knee', flags: ['lockedKnee'] })).tier).toBe('RED_FLAG');
  });
  it('night pain alone is not a red flag, but severe night pain is', () => {
    expect(screen(a({ severity: 5, flags: ['nightPain'] })).tier).toBe('PHYSIO');
    expect(screen(a({ severity: 7, flags: ['nightPain'] })).tier).toBe('RED_FLAG');
  });
  it('pain of 9 or more is a red flag even with no warning sign', () => { expect(screen(a({ severity: 9 })).tier).toBe('RED_FLAG'); });
  it('a red flag always beats everything else, and the emergency wins over "see a doctor"', () => {
    const r = screen(a({ duration: 'gt12w', severity: 8, function: 'cannot', flags: ['weakness', 'bladderBowel'] }));
    expect(r.tier).toBe('RED_FLAG'); expect(r.urgency).toBe('now');
    for (const id of ['R1', 'R5', 'P1', 'P2', 'P3']) expect(r.triggered.map((t) => t.id)).toContain(id);
  });
  it('a warning sign that is not asked for the chosen area is ignored', () => {
    expect(flagsForArea('neck').some((f) => f.id === 'bladderBowel')).toBe(false);
    expect(screen(a({ area: 'neck', flags: ['bladderBowel'] })).tier).toBe('LOW_RISK');
  });
  it('red-flag results carry the patient-facing message in both languages', () => {
    const r = screen(a({ flags: ['chestSymptoms'] })); expect(r.body.en).toMatch('112'); expect(r.body.hi).toMatch('112');
  });
  it('rejects impossible answers', () => {
    expect(validateAnswers(a({ severity: 11 })).length).toBe(1);
    expect(validateAnswers(a({ severity: 2.5 })).length).toBe(1);
    expect(validateAnswers(a({ flags: ['made-up'] })).length).toBe(1);
    expect(() => screen(a({ severity: -1 }))).toThrow();
  });
  it('maps area and recent surgery to specialities', () => {
    expect(screen(a({ area: 'knee', recentSurgery: true })).specialties).toEqual(['knee', 'sports', 'post-op']);
  });
});

describe('screening has no network or AI calls', () => {
  it('no marketplace file that decides a tier or ranks physios contains fetch, XHR, or an AI SDK', () => {
    for (const f of ['screening.ts', 'match.ts', 'ledger.ts', 'fees.ts']) {
      const s = readFileSync('src/marketplace/' + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket|anthropic|openai|\bllm\b/i.test(s)).toBe(false);
    }
  });
  it('the marketplace folder has no unexpected files', () => { expect(readdirSync('src/marketplace').sort()).toEqual(['fees.ts', 'handoff.ts', 'ledger.ts', 'match.ts', 'physios.ts', 'screening-pack.json', 'screening.ts', 'store.ts', 'strings.ts']); });
});

describe('slots and matching', () => {
  it('slots follow the weekly pattern and skip booked ones', () => {
    const p = DEMO_PHYSIOS.find((x) => x.id === 'ph-asha')!; // Mon-Sat
    const s = slotsFor(p, [], TODAY, 7);
    expect(s[0]).toEqual({ date: TODAY, time: '10:00' });
    expect(s.some((x) => x.date === '2026-11-29')).toBe(false); // Sunday
    expect(slotsFor(p, [{ date: TODAY, time: '10:00' }], TODAY, 1)[0]).toEqual({ date: TODAY, time: '11:00' });
  });
  const mk = (o: Partial<ScreeningAnswers>, p: Partial<Prefs> = {}) => matchPhysios(screen(a(o)), { ...prefs, ...p }, mp().physios, () => [], TODAY);
  it('never shows an unverified physiotherapist', () => {
    const ids = mk({}).map((m) => m.physio.id);
    expect(ids.includes('ph-new1')).toBe(false); expect(ids.includes('ph-new2')).toBe(false);
  });
  it('a back problem ranks a spine specialist first; a sports injury ranks a sports specialist first', () => {
    expect(mk({ severity: 5 })[0].physio.specialties).toContain('spine');
    expect(mk({ area: 'sports' }, { locality: 'Lajpat Nagar' })[0].physio.specialties).toContain('sports');
  });
  it('home visits appear only where the physio serves the patient locality', () => {
    const m = mk({ severity: 5 }, { mode: 'home', locality: 'Rohini' });
    expect(m.map((x) => x.physio.id)).toEqual(['ph-sourav']);
  });
  it('the budget filter uses the cheapest eligible visit', () => {
    const m = mk({ severity: 5 }, { maxFee: 400 });
    expect(m.length > 0).toBe(true); expect(m.every((x) => x.fromFee <= 400)).toBe(true);
  });
  it('a Pro plan never lifts a worse match above a clearly better one', () => {
    const ms = mk({ area: 'mobility', function: 'cannot' }, { locality: 'Saket' });
    expect(ms[0].physio.specialties).toContain('functional');
  });
  it('every match gives at least one reason a patient can read, in both languages', () => {
    const m = mk({ severity: 5 })[0]; expect(m.reasons.length > 0).toBe(true); expect(m.reasons[0].hi.length > 0).toBe(true);
  });
});

describe('fees', () => {
  it('splits a fee by plan and mode, in whole rupees, with nothing lost', () => {
    const s = splitFee('basic', 'clinic', 700); expect(s).toEqual({ fee: 700, pct: 12, commission: 84, payout: 616 });
    const h = splitFee('pro', 'home', 1100); expect(h.commission + h.payout).toBe(1100); expect(h.pct).toBe(14);
  });
  it('the config is marked as placeholder', () => { expect(FEE_CONFIG.review).toBe('NEEDS_BUSINESS_REVIEW'); });
});

describe('booking', () => {
  const book = (s: MpState, o: Record<string, unknown> = {}) => bookSlot(s, { physioId: 'ph-asha', mode: 'clinic', slot: { date: TODAY, time: '10:00' }, patientName: 'Test Patient', phone: '98765 43210', answers: a({ severity: 5 }), consent: true, nowIso: TODAY + 'T09:00:00Z', today: TODAY, ...o } as Parameters<typeof bookSlot>[1]);
  it('books a slot and stores the screening summary, fee and a clean phone number', () => {
    const r = ok(book(mp())); expect(r.booking).toMatchObject({ status: 'booked', fee: 700, phone: '9876543210', physioName: 'Dr. Asha Verma' });
    expect(r.booking!.screening).toMatchObject({ tier: 'PHYSIO', area: 'back', severity: 5, rules: ['P2'] });
  });
  it('refuses to book a red-flag screening, even though the screen would hide the button', () => {
    const r = book(mp(), { answers: a({ flags: ['bladderBowel'] }) }); expect(r.ok).toBe(false);
  });
  it('re-screens from the answers, so a sent-in "low risk" label cannot get past a red flag', () => {
    expect(book(mp(), { answers: a({ severity: 9 }), tier: 'LOW_RISK' }).ok).toBe(false);
  });
  it('refuses double booking, past the window, wrong mode, unverified physio, missing consent, bad phone or name', () => {
    const first = ok(book(mp()));
    expect(book(first.state).ok).toBe(false);
    expect(book(mp(), { slot: { date: '2026-12-30', time: '10:00' } }).ok).toBe(false);
    expect(book(mp(), { slot: { date: TODAY, time: '03:00' } }).ok).toBe(false);
    expect(book(mp(), { physioId: 'ph-rohan', mode: 'home' }).ok).toBe(false);
    expect(book(mp(), { physioId: 'ph-new1', mode: 'online' }).ok).toBe(false);
    expect(book(mp(), { consent: false }).ok).toBe(false);
    expect(book(mp(), { phone: '12345' }).ok).toBe(false);
    expect(book(mp(), { patientName: '  ' }).ok).toBe(false);
  });
  it('a cancelled slot becomes free again', () => {
    const first = ok(book(mp())); const c = ok(setBookingStatus(first.state, first.booking!.id, 'cancelled'));
    expect(takenSlots(c.state, 'ph-asha')).toEqual([]); ok(book(c.state));
  });
  it('cleans phone numbers', () => { expect(cleanPhone('+91 98765-43210')).toBe('9876543210'); expect(cleanPhone('09876543210')).toBe('9876543210'); expect(cleanPhone('5876543210')).toBeNull(); });
});

describe('visit outcome and revenue', () => {
  const booked = () => { const r = ok(bookSlot(mp(), { physioId: 'ph-asha', mode: 'home', slot: { date: TODAY, time: '11:00' }, patientName: 'A', phone: '9876543210', answers: a({ severity: 5 }), consent: true, nowIso: '', today: TODAY })); return r; };
  it('commission is fixed only when a visit is completed', () => {
    const r = booked(); expect(r.booking!.split).toBeUndefined(); expect(revenue(r.state)).toMatchObject({ upcoming: 1, completed: 0, commission: 0 });
    const done = ok(setBookingStatus(r.state, r.booking!.id, 'completed'));
    expect(done.booking!.split).toEqual({ fee: 1100, pct: 14, commission: 154, payout: 946 });
    expect(revenue(done.state)).toMatchObject({ completed: 1, gmv: 1100, commission: 154, payouts: 946 });
    expect(revenue(done.state).byMode.home).toEqual({ count: 1, gmv: 1100, commission: 154 });
  });
  it('cancelled and missed visits earn nothing', () => {
    const r = booked(); const c = ok(setBookingStatus(r.state, r.booking!.id, 'no-show'));
    expect(revenue(c.state)).toMatchObject({ noShow: 1, commission: 0, gmv: 0 });
  });
  it('a finished booking cannot be changed again', () => {
    const r = booked(); const d = ok(setBookingStatus(r.state, r.booking!.id, 'completed'));
    expect(setBookingStatus(d.state, r.booking!.id, 'cancelled').ok).toBe(false);
  });
  it('subscription income counts verified Pro physios only', () => {
    const r = revenue(mp()); expect(r.proCount).toBe(3); expect(r.subscriptions).toBe(3 * 999);
  });
});

describe('physio verification', () => {
  const draft = { name: 'Dr. New', qualification: 'BPT', registration: 'REG-1', specialties: ['spine'], years: 3, locality: 'Saket', modes: ['clinic' as const], fees: { clinic: 500 }, bio: '' };
  it('a new physio is pending and is not shown to patients until verified', () => {
    const r = ok(registerPhysio(emptyMp(), draft)); const p = r.state.physios[0]; expect(p.status).toBe('pending');
    expect(matchPhysios(screen(a({ severity: 5 })), prefs, r.state.physios, () => [], TODAY)).toEqual([]);
    const v = ok(decideVerification(r.state, p.id, 'verified'));
    expect(matchPhysios(screen(a({ severity: 5 })), { ...prefs, locality: 'Saket' }, v.state.physios, () => [], TODAY).length).toBe(1);
  });
  it('rejects incomplete applications', () => {
    expect(registerPhysio(emptyMp(), { ...draft, registration: ' ' }).ok).toBe(false);
    expect(registerPhysio(emptyMp(), { ...draft, specialties: [] }).ok).toBe(false);
    expect(registerPhysio(emptyMp(), { ...draft, fees: { clinic: 5 } }).ok).toBe(false);
    expect(registerPhysio(emptyMp(), { ...draft, locality: 'Mars' }).ok).toBe(false);
  });
  it('only a pending application can be decided; a rejected physio stays hidden', () => {
    const s = mp(); expect(decideVerification(s, 'ph-asha', 'rejected').ok).toBe(false);
    const r = ok(decideVerification(s, 'ph-new1', 'rejected')); expect(r.state.physios.find((p) => p.id === 'ph-new1')!.status).toBe('rejected');
  });
});

describe('storage', () => {
  const fake = (init: Record<string, string> = {}) => { const m = { ...init }; return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } }; };
  it('the demo starts with the made-up roster; the live clinic starts empty', () => {
    expect(loadMp(false, fake()).physios.length).toBe(10); expect(loadMp(true, fake()).physios).toEqual([]);
  });
  it('the two modes use separate keys', () => {
    const s = fake({ 'rehabpath-marketplace-demo-v1': JSON.stringify({ ...emptyMp(), seq: 7 }) });
    expect(loadMp(false, s).seq).toBe(7); expect(loadMp(true, s).seq).toBe(0);
  });
  it('damaged data falls back to the seed', () => { expect(loadMp(false, fake({ 'rehabpath-marketplace-demo-v1': '{nope' })).physios.length).toBe(10); });
});

describe('hand-off to RehabPath follow-up', () => {
  const done = () => { const r = ok(bookSlot(mp(), { physioId: 'ph-asha', mode: 'clinic', slot: { date: TODAY, time: '10:00' }, patientName: 'Sita Devi', phone: '9876543210', answers: a({ severity: 5 }), consent: true, nowIso: '', today: TODAY })); return ok(setBookingStatus(r.state, r.booking!.id, 'completed')); };
  it('enrols a completed patient into the General protocol, and not twice', () => {
    const d = done(); const app = seedState(); const n = app.patients.length;
    const r = enrolInRehabPath(app, d.booking!, Date.parse(TODAY + 'T10:00:00Z'), TODAY);
    expect('error' in r).toBe(false); if ('error' in r) return;
    expect(r.state.patients.length).toBe(n + 1);
    const p = r.state.patients.find((x) => x.id === r.patientId)!; expect(p).toMatchObject({ name: 'Sita Devi', packId: 'general' });
    const marked = markEnrolled(d.state, d.booking!.id, r.patientId);
    expect('error' in enrolInRehabPath(r.state, marked.bookings[0], 1, TODAY)).toBe(true);
  });
  it('refuses to enrol before the visit is completed', () => {
    const r = ok(bookSlot(mp(), { physioId: 'ph-asha', mode: 'clinic', slot: { date: TODAY, time: '10:00' }, patientName: 'X', phone: '9876543210', answers: a({ severity: 5 }), consent: true, nowIso: '', today: TODAY }));
    expect('error' in enrolInRehabPath(seedState(), r.booking!, 1, TODAY)).toBe(true);
  });
});
