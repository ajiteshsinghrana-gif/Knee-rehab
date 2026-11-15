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

## Run

```
npm install
npm test          # vitest
npm run build     # esbuild -> docs/
npm run signoff   # refresh the list below from the packs
```

## Known limits

- Only Phases 0 and 1 are built so far. Exercise library, real plan changes on approval, physio onboarding, protocol import, caregiver mode, read-aloud, Supabase and FHIR are not.
- The photo field stores the file name only. There is no upload yet.
- Approve / Modify records a decision and marks the flag reviewed. It does not edit the plan yet.
- The Overdue clock in the demo uses the demo calendar, not real time.
- Adherence (A3) divides by the full 7-day window even in the first week after surgery, as in the previous build. A patient with few days of data can trip A3.
- TSK-11 is used as in the previous build. Licensing and citation are still to be confirmed (Phase 4.3).

## Sources

- Melbourne ACL Rehabilitation Guide 2.0 (Cooper and Hughes): gates and ACL defaults.
- RULES.md in the project: SAFETY additions and DEFAULT values.
- TSK-11 (Woby et al., 2005).

## NEEDS_PHYSIO_SIGNOFF values

Every value below is a placeholder. Do not treat any of them as clinical guidance. This list is generated by `npm run signoff`, and a test checks it is complete.

<!-- SIGNOFF:START -->

#### acl-reconstruction (10 values)

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

#### total-knee-replacement (24 values)

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

#### rotator-cuff-repair (20 values)

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
| precaution sling-off restricted phases | p1 | NEEDS_PHYSIO_SIGNOFF |

<!-- SIGNOFF:END -->
