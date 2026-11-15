# RehabPath

A condition-agnostic rehab companion. Patients do a short daily check-in (buttons or voice, English or Hindi). Physios get a worklist that is sorted by deterministic triage rules. All clinical content lives in **protocol packs**, not in code.

Live build is served from `docs/` (GitHub Pages: Settings > Pages > Deploy from branch > `/docs`). Source is in `src/`.

## Safety rules (non-negotiable)

1. **No LLM anywhere in triage.** Tiers come only from the deterministic rules in the pack. A test fails the build if the engine or voice parser contains network or LLM calls.
2. **Nothing changes a patient's plan, phase or exercises until the physio approves it.** The engine only returns flags and suggestions. Gates show "Ready for Phase X" for sign-off; nobody is advanced automatically.
3. **Every threshold carries a source tag.** Where no value was given, a placeholder tagged `NEEDS_PHYSIO_SIGNOFF` is used and listed below. The pack validator rejects a threshold with no source tag.
4. **All patient-facing text exists in English and Hindi.** A test compares both dictionaries key by key, and the validator rejects pack text without `hi`.
5. **The demo bar keeps working.** Ravi's three-day fast-forward ends URGENT via R5 (tested). Meera ends SAFETY (tested).

## Tiers

| Tier | Meaning | Response time (config) |
|---|---|---|
| SAFETY | Red-flag symptom. Patient sees "Seek care now: call 112". | 2 h (placeholder) |
| URGENT | R2 giving way/locking, R3 high pain, R4 knee not straight, R5 combination | 24 h |
| REVIEW | Amber rules (A1 to A8) | 72 h |
| ON_PLAN | No rule triggered | weekly summary |

When the response time passes and the flag has not been reviewed, the worklist shows **Overdue** and sorts it to the top of its tier. The clock starts when the flag episode began, not at the latest check-in.

## Architecture

```
src/
  types.ts            ProtocolPack, Patient, Trigger ... (no condition-specific code)
  packs/*.json        acl-reconstruction, total-knee-replacement, rotator-cuff-repair
  engine/
    triage.ts         generic rule engine: threshold, trend, streak, belowCurve,
                      gateOverdue, silence, precautionBreach, combination (+ warning signs)
    gates.ts          criteria-driven phase gates
    validator.ts      pack validator (runs at load and in tests)
    signoff.ts        lists every NEEDS_PHYSIO_SIGNOFF value
    actions.ts        rule -> suggested action (never auto-applied)
  voice/parser.ts     voice text -> pre-filled answers (regex, per-clause negation)
  checkin.ts          check-in generated from the pack; save is blocked until every sign is answered
  store.ts            localStorage state, key rehabpath-v1, migration from acl-rehab-v1
  demo/seed.ts        Ravi (ACL), Meera, Arjun, Sana, Kamla (knee replacement), Imran (rotator cuff)
  ui/                 React views: patient phone, physio dashboard, demo bar
tests/                Vitest: every rule, voice cases, pack validator, migration, safety guards
legacy/               the previous single-file build (acl-rehab-v1), kept for reference
```

### Rule types (all read from `rules[]` in the patient's pack)

| Type | Example |
|---|---|
| `threshold` (stage-aware) | pain >= X, with a list of post-op week ranges |
| `trend` | pain up >= 2 over 3 check-ins |
| `streak` | 2 missed days in a row; same hard movement on 3 of 7 days |
| `belowCurve` | measure below the expected band at the week it was recorded |
| `gateOverdue` | phase gate not met by the phase's max weeks |
| `silence` | no check-in for N hours |
| `precautionBreach` | restricted movement reported in a restricted phase |
| `combination` | >= N distinct REVIEW rules within M days gives URGENT |

Warning signs live in `warningSigns[]` and map straight to a tier. Numbness is configurable per pack (ACL: amber `A8`, tagged for sign-off).

### Adding a condition

Copy a pack in `src/packs/`, register it in `src/engine/packs.ts`, run `npm test`. The validator rejects: no warning signs, overlapping phases, a rule pointing to an unknown measure, a threshold without a source tag. Check-in questions, exercises, curves and warning signs change with no code change.

"Overlapping phases" in a criteria-driven protocol means duplicate phase ids or order numbers, or two gates for the same transition. Phases have no calendar windows, only expected time in phase.

## Personalised plan (Phase 2)

- **Exercise library** (`src/exercises/library.json`): one record per exercise with English and Hindi names, a picture path, a dose, the packs and phases that use it, and an easier version (`regressionId`). Packs list exercise ids only. The validator rejects unknown ids, regression loops and `usedIn` that disagrees with the packs.
- **Pictures are placeholders** (`public/media/*.svg`, emoji). Replace them with the physio's real pictures or clips under the same file names. Doses and regressions are tagged `NEEDS_PHYSIO_SIGNOFF` (see the list below).
- **Patient check-in** shows today's exercises as picture cards with Done / Could not do. "Could not do" asks why (pain, scared, no time, can't access, didn't understand). "Hardest movement" lists the prescribed exercises.
- **Approving an action changes the plan, and only the physio can do it** (`src/engine/plan.ts` is the only code that writes the plan; triage never does):
  - Regress exercise: the physio picks an exercise, it is swapped for its easier version (can be restored).
  - Hold progression: blocks phase sign-off until the hold is removed.
  - Change follow-up: updates check-in frequency and next review date; optional end date after which the old frequency returns.
  - Every change goes to a per-patient audit log: who, when, before and after, note.
- **URGENT through a combination of rules** proposes a follow-up (`followUpProposal` in the pack: tele-review within 48 h, daily check-ins for 7 days; all `NEEDS_PHYSIO_SIGNOFF`) as a before/after table with Approve / Edit / Reject. Rejecting leaves the plan unchanged.
- **Patient notice**: after any plan change the home screen says, in the patient's language, "Your physio reviewed this on <date> and changed <X>", with a read-aloud button (browser speech synthesis).
- **Per-patient threshold overrides** (`src/engine/overrides.ts`): the physio can change any rule or gate number for one patient. A reason is required, it is logged, and the rule's evidence shows `PHYSIO_OVERRIDE: <reason>`. The shared pack is never modified. Warning-sign tiers cannot be overridden.

## Onboarding and protocol import (Phase 3)

- **Add patient** (physio dashboard): details, exercises, follow-up and optional per-patient thresholds, then a review step. Nothing is created until the physio approves. Adjustments go through the same audited plan actions as Phase 2. A new patient is never counted as missing days before `enrolledOn`.
- **Invite**: a link (`#join=...`) and a QR code carrying the patient and plan. Opening it on the patient's phone adds the patient. For a patient on an imported protocol the link also carries the changed fields so the other device rebuilds the same pack. The QR is a small built-in encoder (`src/qr.ts`), checked against OpenCV; very large plans fall back to link only.
- **Import protocol** (`src/import/`): the physio types or pastes the protocol, or uploads a PDF, text, CSV or JSON file. A deterministic reader (no AI) matches lines to known fields (gates, rule thresholds, response hours, phase follow-up, sessions, exercise lists). "Download template" gives lines like `Label [target]: value`. Ambiguous lines are chosen by the physio; values outside range and unknown exercises are reported, not guessed.
- **The physio approves each field.** Untouched fields keep the base pack's defaults. Changed values are tagged `PHYSIO_IMPORTED: <file name>`, the new pack records `basedOn` and the changed fields, and it passes the same validator as built-in packs.
- AI-assisted extraction is deferred to Phase 6 (needs a backend). Scanned PDFs have no text layer: paste the text instead.
- The invite link carries the patient's name and plan, so share it privately. Until Phase 6, a patient's answers stay on the phone that opened the link.

## Any condition (Phase 3.3)

- **+ Add a condition** (physio dashboard): the physio writes a protocol for a condition the app does not ship. Phases and their exercises, weekly measures the patient enters (angle, distance, weight, a score), the criteria to move to the next phase, threshold alerts, extra warning signs and restricted movements are all typed by the physio. A draft can be downloaded and loaded again as a JSON file.
- **New exercises**: the physio can write exercises (English and Hindi name, optional dose). They join the shared library. A dose left empty shows "as shown by your physio" and is listed for sign-off. Pictures are one shared placeholder (`public/media/custom.svg`) until real ones are supplied.
- **Always on, cannot be removed**: fever, calf pain or redness, wound fluid, spreading redness, chest pain or breathlessness (SAFETY, source tag `SAFETY`), new numbness or tingling, several signals together, pain rising, missed sessions.
- **No invented values.** What the physio types is tagged `PHYSIO_AUTHORED`. The alert timings (response hours, missed sessions, several signals, pain rising, follow-up proposal) are either typed by the physio or filled with the project's existing placeholders, which are tagged `NEEDS_PHYSIO_SIGNOFF` and appear in the sign-off list shown for every patient of that condition.
- **Patient text is English and Hindi.** Every patient-facing field the physio writes must have both; the form refuses to save otherwise.
- **Same validator.** The pack is checked by the same validator as the shipped packs. A refused pack leaves nothing behind.
- **Invite links** carry the written protocol so the patient's phone rebuilds it. Links are compressed (a built-in LZSS, `src/lzss.ts`) and leave out default values. A condition with one phase fits in a QR code; larger ones usually do not, and the app then shows the link only. Links made before compression still open.
- **Expected recovery (optional)**: for a weekly measure the physio enters expected values by week since day zero and an allowed gap. This adds the existing below-the-curve alert (REVIEW; the rule tier is tagged `NEEDS_PHYSIO_SIGNOFF`, the curve itself `PHYSIO_AUTHORED`).
- **New versions**: a saved condition cannot be edited. "Start from one of your written conditions" copies it into the form (new exercise ids, name gets "(version N)"); saving creates version N. The old condition and its patients are untouched. Moving an existing patient to a new version is not built.
- Importing a protocol file (3.2) works on the shipped conditions only.

## Monitoring (Phase 4)

- **Photo angle (4.1)**: in the weekly self-test the patient can add a photo and tap three points (hip, knee, ankle for knee bend; hip, shoulder, wrist for arm raise; points can be dragged). The app computes the angle with plain geometry (`src/angle.ts`), shows it, and fills the box on "Use this angle". Typing the number still works. The photo is shown from memory and is not stored or sent. The physio sees "(measured on photo)" next to the reading in the gate table. Packs opt in per measure with `photoAngle` (validated). Written conditions do not have this yet.
- **Questionnaires (4.2)**: every questionnaire carries a credit line and a flag for whether permission to use it is confirmed. TSK-11 shows its authors (Woby et al., 2005) and is listed under NEEDS_PHYSIO_SIGNOFF until the physio confirms permission. **The Oxford Knee Score and Oxford Shoulder Score are not included**: they are licensed by their publisher and their wording cannot be bundled here. A physio who holds a licence can type any questionnaire into "Add a condition" (monthly, scored by summing option values, optional REVIEW alert on the total, permission box required). The physio's patient view shows the latest score with the credit line.
- **Silence (4.3)**: all three shipped conditions and every written condition raise a REVIEW alert when a patient has not checked in for a set time. It is labelled "No check-in for N days" in English and Hindi with the real number of days. The hours are placeholders (72 h) tagged NEEDS_PHYSIO_SIGNOFF.
- Still to come in later phases: caregiver mode, third language, backend.

**Phase 4.1.** Written conditions can mark a weekly measure as "measured on a photo": the physio names the three points to tap (English and Hindi) and picks the reading (angle between, or deviation from straight). The photo stays on the patient's phone. A physio can also load a questionnaire from a JSON file, save it for reuse in other conditions, or download it. A loaded file never confirms permission: "permission to use" is always unticked until the physio ticks it, and it stays on the sign-off list.

## Third language: Bengali (Phase 5.1)

Patients can use English, Hindi or Bengali (the language button cycles through them; the physio picks it when adding a patient, and it travels in the invite). All screen text, the three built-in conditions and the exercise list have Bengali wording (`src/i18n/bn.ts`, `src/i18n/bn-content.ts`). Tests fail if a screen string or built-in pack string has no Bengali version.

- **NEEDS_NATIVE_REVIEW:** the Bengali was written by Claude and has not been read by a Bengali-speaking clinician. Have one check it before real patients use it, above all the warning signs, the "seek care now" screen and the TSK-11 sentences.
- Text a physio writes for a new condition is English + Hindi. In Bengali it shows the built-in wording where the English matches (for example "Pain"), otherwise English.
- Read aloud and voice input use the browser's Bengali voice (`bn-IN`). The read-aloud button hides itself on phones with no Bengali voice. Voice input does not pre-fill answers in Bengali yet; the patient taps instead, and the tapped warning-sign step is unchanged.
- The physio screens stay English-only.

## Run

```
npm install
npm test          # vitest
npm run build     # esbuild -> docs/
npm run signoff   # refresh the list below from the packs
```

## Known limits

- Phases 0 to 4 are built. caregiver mode, third language, Supabase, FHIR and AI extraction are not.
- The photo field stores the file name only. There is no upload yet.
- The Overdue clock in the demo uses the demo calendar, not real time.
- Adherence (A3) divides by the full 7-day window even in the first week after surgery, as in the previous build. A patient with few days of data can trip A3.
- TSK-11 now carries its citation. Permission to use it is still to be confirmed by the physio (NEEDS_PHYSIO_SIGNOFF).

## Sources

- Melbourne ACL Rehabilitation Guide 2.0 (Cooper and Hughes): gates and ACL defaults.
- RULES.md in the project: SAFETY additions and DEFAULT values.
- TSK-11 (Woby et al., 2005).

## NEEDS_PHYSIO_SIGNOFF values

Every value below is a placeholder. Do not treat any of them as clinical guidance. This list is generated by `npm run signoff`, and a test checks it is complete.

<!-- SIGNOFF:START -->

#### acl-reconstruction (13 values)

| Where | Value | Source tag |
|---|---|---|
| responseHours.SAFETY | 2 h | PLACEHOLDER; NEEDS_PHYSIO_SIGNOFF |
| phase p1 expectedWeeks / sessions / follow-up | [0,6], 2/day, every 7 d | DEFAULT (max weeks); NEEDS_PHYSIO_SIGNOFF (sessions, follow-up) |
| phase p2 expectedWeeks / sessions / follow-up | [0,12], 2/day, every 7 d | DEFAULT (max weeks); NEEDS_PHYSIO_SIGNOFF (sessions, follow-up) |
| phase p3 expectedWeeks / sessions / follow-up | [0,null], 0/day, every 7 d | MELBOURNE; NEEDS_PHYSIO_SIGNOFF (follow-up) |
| curve flexionDeg | 7 points, tolerance 10 | DEFAULT (curve); NEEDS_PHYSIO_SIGNOFF (tolerance) |
| curve extensionDeficitCm | 6 points, tolerance 0.5 | DEFAULT (curve); NEEDS_PHYSIO_SIGNOFF (tolerance) |
| warning sign numbness -> tier | REVIEW (A8) | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 0-2 | >= 7 | DEFAULT; NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 2-6 | >= 7 | DEFAULT; NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 6-end | >= 7 | DEFAULT; NEEDS_PHYSIO_SIGNOFF |
| rule S1 silence | 72 h | NEEDS_PHYSIO_SIGNOFF |
| followUpProposal | tele-review within 48 h, check-ins every 1 d for 7 d | NEEDS_PHYSIO_SIGNOFF |
| questionnaire tsk11 permission to use | Tampa Scale for Kinesiophobia, 11-item version (TSK-11): Woby SR, Roach NK, Urmston M, Watson PJ. Pain 2005;117:137-144. Permission to use in this app: to be confirmed by the physio. | NEEDS_PHYSIO_SIGNOFF |

#### total-knee-replacement (26 values)

| Where | Value | Source tag |
|---|---|---|
| responseHours.SAFETY | 2 h | PLACEHOLDER; NEEDS_PHYSIO_SIGNOFF |
| responseHours.URGENT | 24 h | NEEDS_PHYSIO_SIGNOFF |
| responseHours.REVIEW | 72 h | NEEDS_PHYSIO_SIGNOFF |
| phase p1 expectedWeeks / sessions / follow-up | [0,6], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| phase p2 expectedWeeks / sessions / follow-up | [0,12], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| phase p3 expectedWeeks / sessions / follow-up | [0,null], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| gate p1->p2 g1.flexion | flexionDeg >= 90 | NEEDS_PHYSIO_SIGNOFF |
| gate p1->p2 g1.extension | extensionDeficitDeg <= 5 | NEEDS_PHYSIO_SIGNOFF |
| gate p2->p3 g2.flexion | flexionDeg >= 110 | NEEDS_PHYSIO_SIGNOFF |
| gate p2->p3 g2.extension | extensionDeficitDeg <= 3 | NEEDS_PHYSIO_SIGNOFF |
| curve flexionDeg | 4 points, tolerance 10 | NEEDS_PHYSIO_SIGNOFF |
| curve extensionDeficitDeg | 4 points, tolerance 3 | NEEDS_PHYSIO_SIGNOFF |
| warning sign fall -> tier | URGENT (R2) | NEEDS_PHYSIO_SIGNOFF |
| warning sign givingWay -> tier | URGENT (R2) | NEEDS_PHYSIO_SIGNOFF |
| warning sign numbness -> tier | REVIEW (A8) | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 0-2 | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 2-6 | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 6-end | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R5 combination | >= 2 REVIEW rules in 3 d | NEEDS_PHYSIO_SIGNOFF |
| rule A1 pain up by | 2 over 3 check-ins | NEEDS_PHYSIO_SIGNOFF |
| rule A2 streak | 2 in a row | NEEDS_PHYSIO_SIGNOFF |
| rule A3 streak | 2 in a row; adherence < 60% | NEEDS_PHYSIO_SIGNOFF |
| rule A6 (gateOverdue) tier | REVIEW | NEEDS_PHYSIO_SIGNOFF |
| rule C1 (belowCurve) tier | REVIEW | NEEDS_PHYSIO_SIGNOFF |
| rule S1 silence | 72 h | NEEDS_PHYSIO_SIGNOFF |
| followUpProposal | tele-review within 48 h, check-ins every 1 d for 7 d | NEEDS_PHYSIO_SIGNOFF |

#### rotator-cuff-repair (22 values)

| Where | Value | Source tag |
|---|---|---|
| responseHours.SAFETY | 2 h | PLACEHOLDER; NEEDS_PHYSIO_SIGNOFF |
| responseHours.URGENT | 24 h | NEEDS_PHYSIO_SIGNOFF |
| responseHours.REVIEW | 72 h | NEEDS_PHYSIO_SIGNOFF |
| phase p1 expectedWeeks / sessions / follow-up | [0,6], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| phase p2 expectedWeeks / sessions / follow-up | [0,6], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| phase p3 expectedWeeks / sessions / follow-up | [0,null], 2/day, every 7 d | NEEDS_PHYSIO_SIGNOFF |
| gate p1->p2 g1.armRaise | armRaiseDeg >= 90 | NEEDS_PHYSIO_SIGNOFF |
| gate p2->p3 g2.armRaise | armRaiseDeg >= 140 | NEEDS_PHYSIO_SIGNOFF |
| curve armRaiseDeg | 4 points, tolerance 15 | NEEDS_PHYSIO_SIGNOFF |
| warning sign numbness -> tier | REVIEW (A8) | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 0-2 | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 2-6 | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R3 pain stage weeks 6-end | >= 7 | NEEDS_PHYSIO_SIGNOFF |
| rule R5 combination | >= 2 REVIEW rules in 3 d | NEEDS_PHYSIO_SIGNOFF |
| rule A1 pain up by | 2 over 3 check-ins | NEEDS_PHYSIO_SIGNOFF |
| rule A3 streak | 2 in a row; adherence < 60% | NEEDS_PHYSIO_SIGNOFF |
| rule A6 (gateOverdue) tier | REVIEW | NEEDS_PHYSIO_SIGNOFF |
| rule P1 (precautionBreach) tier | REVIEW | NEEDS_PHYSIO_SIGNOFF |
| rule C1 (belowCurve) tier | REVIEW | NEEDS_PHYSIO_SIGNOFF |
| rule S1 silence | 72 h | NEEDS_PHYSIO_SIGNOFF |
| precaution sling-off restricted phases | p1 | NEEDS_PHYSIO_SIGNOFF |
| followUpProposal | tele-review within 48 h, check-ins every 1 d for 7 d | NEEDS_PHYSIO_SIGNOFF |

#### exercise library (34 values)

| Where | Value | Source tag |
|---|---|---|
| exercise ankle-pumps dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise assisted-arm-raise dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise balance dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise band-rotation dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise bridging dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise calf-raises dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise core dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise cycling dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise gait-drills dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise gentle-rom dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise hand-wrist-elbow dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise heel-slides dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise hip-abduction dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise ice-compression dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise ice-elevation dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise lunges dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise lunges easier version | mini-squats | NEEDS_PHYSIO_SIGNOFF |
| exercise mini-squats dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise pendulum dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise quad-set dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise shoulder-blade-squeeze dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise sit-to-stand dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise squats dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise squats easier version | mini-squats | NEEDS_PHYSIO_SIGNOFF |
| exercise stairs-practice dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise stationary-cycling dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise step-ups dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise step-ups easier version | mini-squats | NEEDS_PHYSIO_SIGNOFF |
| exercise straight-leg-raise dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise swimming dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise walking dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise walking-aid dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise walking-programme dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |
| exercise wall-slide dose | Sets and repetitions: as shown by your physio | NEEDS_PHYSIO_SIGNOFF |

<!-- SIGNOFF:END -->
