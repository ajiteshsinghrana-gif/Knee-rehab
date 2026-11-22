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
| SAFETY | Red-flag symptom. Patient sees one of two messages (Phase 6.3): "Seek care now: call 112" for chest pain or breathlessness, or "Contact your surgeon or clinic today" (112 only if they cannot be reached or it gets worse) for calf pain/redness, fever, wound fluid, spreading redness. | 2 h (placeholder) |
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
- Scanned PDFs have no text layer: paste the text instead.

## AI drafting of a new condition (Phase 6.6)
Import protocol, then **Draft a new condition (AI)** reads an uploaded or pasted document for a condition the app does not ship.
- **The AI is a reader, not a clinician.** A Supabase Edge Function (`supabase/functions/draft-protocol`) asks Claude to copy phases, exercises, weekly measures, gate criteria, alert thresholds, warning signs and restricted movements into a fixed form. It must give the exact quote for every item, use null instead of guessing a number, and list what the document does not say. Only a signed-in physio can call it (the anon key alone is refused).
- **The physio approves every item.** The app shows each item beside its quote and checks the quote really appears in the file. Items whose quote is not found start unticked. Only ticked items reach the draft, which opens in the normal "Add a condition" editor and passes the same validator as every other protocol. The quotes stay with the condition.
- **Nothing is invented.** Values the document does not give (sessions per day, review interval, alert timings) stay as the project placeholders tagged `NEEDS_PHYSIO_SIGNOFF`. The Hindi wording is written by the AI and is flagged for a Hindi-speaking clinician to check.
- **No AI in triage.** Tiers still come only from deterministic rules.
- **Setup (once):** `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` then `supabase functions deploy draft-protocol`. Optional secrets: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `DRAFT_MAX_CHARS` (default 80000). Sign in as a physio (live mode) to use it. The function is untested against the live API in this repo (the tests cover the reader, quote check and mapping); try one document before relying on it.
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

**Phase 4.1.** Written conditions can mark a weekly measure as "measured on a photo": the physio names the three points to tap (English and Hindi) and picks the reading (angle between, or deviation from straight). The photo stays on the patient's phone. A physio can also load a questionnaire from a JSON file, save it for reuse in other conditions, or download it. A loaded file never confirms permission: "permission to use" is always unticked until the physio ticks it, and it stays on the sign-off list.

## Third language: Bengali (Phase 5.1)

Patients can use English, Hindi or Bengali (the language button cycles through them; the physio picks it when adding a patient, and it travels in the invite). All screen text, the three built-in conditions and the exercise list have Bengali wording (`src/i18n/bn.ts`, `src/i18n/bn-content.ts`). Tests fail if a screen string or built-in pack string has no Bengali version.

- **NEEDS_NATIVE_REVIEW:** the Bengali was written by Claude and has not been read by a Bengali-speaking clinician. Have one check it before real patients use it, above all the warning signs, the "seek care now" screen and the TSK-11 sentences.
- Text a physio writes for a new condition is English + Hindi. In Bengali it shows the built-in wording where the English matches (for example "Pain"), otherwise English.
- Read aloud and voice input use the browser's Bengali voice (`bn-IN`). The read-aloud button hides itself on phones with no Bengali voice. Voice input does not pre-fill answers in Bengali yet; the patient taps instead, and the tapped warning-sign step is unchanged.
- The physio screens stay English-only.

## Read aloud and caregiver mode (Phase 5.2, 5.3)

- **Read aloud on every question.** Each check-in step, each weekly test card, each questionnaire sentence, the "seek care now" screen and the thank-you screen has a "Read aloud" button. It reads the question and its choices in the patient's language using the phone's own voice (no network, no AI). Reading stops when the patient moves on. It never answers for the patient: they still tap every answer, including every warning sign.
- **Caregiver mode.** A tick box on the patient's home screen, "I am answering for {name}". The physio can also tick "a family member or carer will usually answer" when adding the patient; this travels in the invite. While it is on, a banner shows on every answering screen, and new check-ins, weekly tests and questionnaires are saved with `answeredBy: caregiver`. The physio screen shows "(caregiver)" on those days, how many of the last 7 check-ins a carer answered, and notes that these are second-hand reports.
- Caregiver mode changes only who is recorded as answering. Triage, thresholds and the plan are identical, and a warning sign reported by a carer is treated the same as one the patient reports.
- Not built yet: asking the carer's name or relationship, and treating a carer's answers with different thresholds. Neither has a clinical source, so both would be NEEDS_PHYSIO_SIGNOFF decisions for you.

## Physio-initiated changes (Phase 5.4)

The physio can change a patient's treatment on his own, without waiting for a suggested action. On each patient, "Adjust the treatment yourself" can: add an exercise, remove an exercise, make an exercise easier, put progression on hold or remove the hold, and move the patient to any phase (forward, back or skipping), including before the gate criteria are met.

- **A written reason is required for every change** (the button stays disabled without one; the engine refuses too). It is saved in the audit log, marked "physio-initiated".
- **The patient is told what changed**, in their language, on their home screen with a read-aloud button: "your exercises: added Swimming", "your stage: you are now in ...". The reason is for the audit log only; it is not shown to the patient.
- **Overriding the protocol is allowed but visible.** If a phase move goes against the protocol (gate criteria not met, a hold is on, a phase is skipped, or the move is backwards), the screen lists why and the physio ticks "I understand this overrides the protocol". The audit log records the direction, the unmet criteria and that the protocol was overridden.
- Moving phase resets that patient's exercise swaps and additions to the new phase's list.
- Triage does not change: these are physio actions through `applyManual` in `src/engine/plan.ts`, the only way the plan changes (safety rule 2). The physio can still choose any change; the app only makes sure it is deliberate, explained and told to the patient.
- Not built: showing the reason to the patient, or free-text patient messages. Reasons are typed in English and could not be translated safely.

## Install and offline use (Phase 7.3)

RehabPath is a progressive web app. On Android (Chrome) use **Install app / Add to Home screen**; on iPhone and iPad open it in Safari and use **Share, Add to Home Screen**. It then opens full screen with its own icon and **opens with no internet**.

- **What is saved:** the app's own files (page, script, styles, icons, exercise pictures), about 40 files. `scripts/build.mjs` writes `docs/sw.js` from `scripts/sw.template.js` last, with a version that is a hash of those files, so every deploy that changes the app is a new version.
- **What is never saved by the service worker:** anything from another address (Supabase, YouTube, uploaded videos), so sign-in, sync and patient data never pass through it. Patient data stays in the app's own storage on the device as before, and sync sends it when the connection is back.
- **Updates are the person's choice:** a new version downloads in the background and waits. The bar at the bottom says "A new version of the app is ready" with **Update now** (English, Hindi, Bengali). This keeps clinical rules from changing in the middle of a check-in. An app left open checks again each time it is reopened and hourly.
- **Offline bar:** shows when the phone reports no network. A phone on wifi with no internet still reports "online"; the sync chip then shows the sync problem.
- **Always rebuild before you push:** `npm run build`, then commit `docs/`. `tests/pwa.test.ts` fails if `docs/sw.js` is out of date with the files it caches.
- **iPhone note:** the Home Screen app has its own storage, separate from Safari. A patient who opened their invite link in Safari and then installs the app starts with an empty app. Have patients install first and open the invite link from the installed app, or join again after installing. Safari may also clear a web app's storage after weeks without opening it.
- **Not offline:** sign-in, sync, AI protocol import, YouTube and cloud videos, and (in Chrome) voice answers.
- Not built: push notifications and background sync (a PWA on iPhone supports push only for installed apps, from iOS 16.4); store listings (use Capacitor for that).

## Exercise videos (Phase 7.2)

The physio can show patients the ideal way to do each exercise. On the physio dashboard, **🎬 Exercise videos** lists every exercise; each one takes a **link** or an **uploaded video**. Patients then see a **Watch how to do it** button on that exercise, in their exercise list and on the exercise cards of the daily check-in, in English, Hindi or Bengali.

- **Links**: only `https://` addresses are accepted. YouTube links (watch, youtu.be, shorts, embed) play inside the app through `youtube-nocookie.com`; a direct `.mp4`/`.webm`/`.mov` link plays in the phone's video player; any other page opens in the browser (`noopener`).
- **Uploads**: MP4, WebM or MOV, up to 50 MB (Supabase's free-plan cap). Signed in as a physio, the file goes to the `exercise-demos` storage bucket and its public address travels to patients. Not signed in, or with sync off, it is kept in this browser only (IndexedDB) and the screen says patients cannot see it. Replacing or removing a video deletes the stored file.
- **Clinic-wide**: a demo belongs to the exercise, so every patient who has that exercise sees it (including an exercise the physio adds or swaps in for one patient). The plan card shows 🎬 video / no video next to each exercise.
- **Sync**: the physio's side owns this (it rides the existing "down" slice, only for that patient's own exercises). The phone checks every address again before using it. A removed demo disappears from the phone; a device-only video is never sent.
- **Not a plan change**: it never touches triage, thresholds or the prescribed exercises, so it is not an audit-log item and needs no reason.
- **Setup for cloud uploads (once):** run `supabase/schema-exercise-videos.sql` in the Supabase SQL editor after `schema-v3.sql`. It makes the public-read bucket, lets signed-in non-patient accounts upload, and lets only the uploader delete. The upload code is tested against a stub of Supabase Storage, not the live service: upload one short clip and open it on a phone before relying on it.
- **Privacy**: the bucket is public (a patient's phone has no account to play with), and files have random names. Teaching videos only: the upload form warns never to upload a video of a patient. The Hindi and Bengali button wording needs a native reader (NEEDS_NATIVE_REVIEW).
- Not built: video captions or a Hindi/Bengali voice-over, thumbnails, per-patient videos, and compressing large videos in the browser.

## Demo (Phase 7)

Six demo patients: Ravi, Meera, Arjun, Sana (ACL), Kamla (knee replacement, Hindi, answered by her carer, below the expected curve) and Imran (rotator cuff, sling phase, Bengali, took the arm out of the sling). `DEMO.md` has a four-minute walk-through. Ravi's fast-forward and Meera's SAFETY flag are unchanged and tested.

## Expected recovery curves (Phase 7.1)

The shaded band on each recovery chart, and the "below the expected curve" alert (C1), come from an expected-recovery curve: a few (week, value) points plus an allowed difference. **The curves shipped with the three built-in conditions have no clinical source.** They are placeholders written to demonstrate the alert, tagged NEEDS_PHYSIO_SIGNOFF, and every chart shows "Placeholder curve: not clinically validated, awaiting physio sign-off" until a physio replaces it.

On each patient, "Expected recovery curves" lets the physio replace a curve:
- **This patient only**, or **all patients with this condition** (a clinic default).
- Order of precedence: the patient's own curve, then the clinic default, then the protocol's curve. The shipped pack is never changed; the replacement is applied to a copy.
- A written reason is required (put the source of the numbers there). It is saved in the audit log: on the patient for a patient curve, and on every patient of the condition for a clinic default.
- Weeks must go up, at least two points, allowed difference above 0. The chart note then says who set the curve and why.
- Either kind can be removed again (with a reason).
- A clinic default is kept in this browser's saved state with the patients (it is not part of live sync yet), so on another phone or computer the clinic default is not there.
- Only measures that already have a curve can be edited. A physio-written condition sets its curves in the "expected recovery" section of the form.

## Run

```
npm install
npm test          # vitest
npm run build     # esbuild -> docs/
npm run signoff   # refresh the list below from the packs
```

## Known limits

- Built: Phases 0 to 5, 7, live sync (6.1), physio sign-in (6.2) and patient accounts (6.3). AI-assisted protocol drafting (6.6, needs the function deployed). Not built: FHIR.
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
| curve flexionDeg | 7 points, tolerance 10 | NEEDS_PHYSIO_SIGNOFF (placeholder curve and tolerance, no clinical source) |
| curve extensionDeficitCm | 6 points, tolerance 0.5 | NEEDS_PHYSIO_SIGNOFF (placeholder curve and tolerance, no clinical source) |
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

## Live sync (Phase 6.1)

Patient phones and the physio dashboard can share data through a Supabase table, so a check-in done on the patient's phone appears on the physio screen, and approved plan changes reach the patient's phone.

**Set up (once, about 10 minutes):**
1. Create a free project at supabase.com.
2. SQL Editor: paste and run `supabase/schema.sql`.
3. Project Settings > API: copy the Project URL and the `anon` public key.
4. Put them in `sync.config.json` as `{ "url": "...", "anonKey": "..." }`, then run `node scripts/build.mjs` and commit `docs/`.
Leaving both empty keeps sync off; the app then works exactly as before.

**What goes each way:**
- Phone to physio ("up"): daily and weekly/monthly check-ins, language, caregiver mode, which notices were seen.
- Physio to phone ("down"): name, age, dates, current phase, sessions per day, the plan (with physio reasons removed) and notices.
- Never leaves the physio computer: audit log, decisions, review state, and every physio reason. Incoming data is validated and copied field by field; the phone can never change a plan.

**Limits (be honest in the demo):**
- Security is a secret link/key only. Anyone with a patient's invite link can read and write that patient's rows. There is no real login yet. **Do not use real patient data** until proper authentication, consent and compliance are in place.
- 6.1 was checked on a real Supabase project on 15 Nov 2026 (a check-in reached the physio and flagged SAFETY). The plan-change-to-phone direction and everything in 6.2 below have only been tested against the fake local server (`scripts/fake-supabase.mjs`).
- Offline: the app keeps working and catches up when the connection returns.
- Without sign-in (6.2), the physio device keeps the keys in its browser storage, so one physio device only.
- Demo patients are never synced. The demo calendar (Fast-forward) is shared by all and is not synced.

## Physio sign-in (Phase 6.2)

Turns the secret link into a real per-patient access rule. **Off by default**: nothing changes until you do the steps below.

**What it does**
- A physio creates an account (email and password, Supabase Auth) on the Physio dashboard. Patients never sign in.
- When a signed-in physio adds a patient, that patient's key is registered to the physio (`rehab_owner`, once, automatically).
- For a registered patient the database lets only the owning physio read both slices or write the plan ("down"). The patient's phone, which has only the secret link, can read the plan and write only its own answers ("up"). A second physio account sees nothing and cannot take a patient over. Nobody can delete rows.
- Patients added before sign-in existed (keys nobody has registered) behave exactly as in 6.1. A physio who signs in registers the keys of the patients already on that device.
- Signed out, the physio side stops syncing and the dashboard says so. Data stays on the device and sends after the next sign-in.
- The physio can sign in on a second device and see their patients, but a patient's audit log and review state still live only on the device that added the patient (unchanged from 6.1).

**Turn it on (about 5 minutes, do both steps together)**
1. Supabase SQL Editor: run `supabase/schema-v2.sql` (after `schema.sql`; safe to run twice).
2. Authentication settings: for a demo, switch off "Confirm email" so sign-up signs in at once. For anything real, leave it on and add a password policy.
3. Set `"auth": true` in `sync.config.json`, run `node scripts/build.mjs`, commit `docs/`.
4. Open the Physio dashboard, create your account, then add patients as before.

If step 1 is done without step 3 (or the reverse), the physio device shows "Sync problem" until both match.

**Limits (be honest)**
- This is access control for a prototype, not compliance. It has no consent flow, no audit of who read what, no password reset screen and no multi-clinic roles. The patient's link is still a secret that grants access to that patient's answers and plan. Do not use real patient data.
- Tokens are kept in the browser's localStorage on the physio device.
- Tested only against the fake server and in a headless browser, not against a real Supabase project. The SQL in `schema-v2.sql` has not been run on a real database yet.


## Patient accounts and physio tools (Phase 6.3)

**Patients**
- A phone that opens an invite link (or `#signin`) becomes a *patient device*: it shows only the patient's own screens. No demo bar, no physio dashboard, and `#clinician` does nothing there. The flag is per browser. A physio who wants to try the patient view should use a private window; `#reset-device` clears the flag on their own browser.
- With `"auth": true`, the patient creates an email-and-password account the first time. It claims that one patient link and stores the invite, so the patient can **sign in on any phone and get the plan and history back**. The bare link stops working once it is claimed, so a forwarded link cannot be used by someone else.
- The physio's Patient access card shows which email holds the account, can show the invite link and QR again, and can **reset a wrong claim**.
- Sign-out removes the plan from that phone; answers stay on the server and return at the next sign-in.
- Check-ins are now **merged by date**, never replaced, so an empty phone cannot wipe the physio's copy of the history.

**Physio tools**
- *Add patient*: "Condition not listed? + Write a new condition" opens the condition builder, then returns to Add patient.
- *Adjust treatment*: "Other: write your own instruction" (up to 400 characters). It needs a written reason, is saved in the audit log as physio-initiated, shows on the patient's home screen and as a "what changed" notice. The reason is never sent to the patient. A physio can also remove their own instructions.
- *Audit log*: a visible button on the Current plan card, with **Download as CSV** (when, who, action, what changed, reason).

**Two-level warning advice** (`src/safety.ts`): chest pain or breathlessness is an emergency ("call 112 now"). Every other safety sign is same-day ("contact your surgeon or clinic today; hospital or 112 if you cannot reach them or feel worse"). If the signs cannot be determined, the stronger message is shown. This split is our own safety default, not from the protocol source, and **needs physio sign-off**.

**Turn it on (after 6.2 is working)**
1. Supabase SQL Editor: run `supabase/schema-v3.sql` (after `schema.sql` and `schema-v2.sql`; safe to run twice).
2. Merge this branch, run `node scripts/build.mjs`, commit `sync.config.json` and `docs/`.
3. Open a patient's invite link on a phone and create the account.
4. For a demo, switch off "Confirm email" in Supabase Auth; otherwise the patient confirms by email, then taps "I already have an account".

**Limits (be honest)**
- `schema-v3.sql` has not been run on a real Postgres. Tested against the fake server and in a headless browser only.
- No password reset for patients yet. A forgotten password means the physio resets the link and the patient makes a new account (history is kept).
- The first person to open a link claims it. Send links privately.
- Hindi and Bengali strings added in this phase (account screens, the same-day warning, instruction notices) are machine-drafted: **NEEDS_NATIVE_REVIEW**.
- Check-ins are dated by the demo calendar (`state.today`), not the real date, as before.
- Prototype only. Do not use real patient data.

## Patient lifecycle, data rights and DPDP (Phase 6.4)

**Not legal advice.** This is software support built around India's DPDP Act 2023 and DPDP Rules 2025. The Rules were notified on 13 Nov 2025; the main duties (notice, consent, security safeguards, breach reporting, erasure) start on **13 May 2027**. Software cannot make a clinic compliant by itself: the clinic still needs its own policies, a lawyer to confirm the notice wording and retention period, and a way to handle complaints.

**Lifecycle**
- *Active*: on the worklist. *Treatment complete*: the physio marks it with a written note (audit-logged). The patient leaves the worklist and appears under **Past patients**, read-only in effect (the Adjust treatment card is hidden). *Reopen* is available with a note.
- The patient's phone shows "Your treatment is complete" and stops asking for check-ins.
- **Retention**: the clinic sets a period (default 3 years, based on medical-record rules; some guidance says longer). When it passes, the patient is flagged "Review for erasure". **Nothing is deleted automatically.**
- **Erase** (physio, typed-name confirmation): removes the patient from the computer and, if signed in, from the cloud (answers, plan, account link, ownership). The only trace is an erasure-log line with the date, reason and whether an account existed. No name, no email.

**Data rights (patient side, "My data")**
- *Download my data* (right of access): a JSON file with their own check-ins, plan and consent. The physio's private reasons and notes are not in it.
- *Ask my physio to erase my data*: the request reaches the physio with a banner. The physio can erase now, or **keep it and send the patient a reason** (for example, record-keeping rules). This reflects that erasure and medical-record retention can pull in different directions.
- *Delete my login*: removes the email account. The clinic's treatment record stays until the physio erases it.
- *Consent and notice*: before an account is made, the patient sees what is collected, who sees it, how long it is kept and their rights, with the clinic's contact (set under Clinic settings), and must tick to agree. The notice version and time are stored and shown to the physio.

**Claim PIN**: each new patient gets an 8-digit PIN. The physio tells it to the patient (voice or message, not in the link). Creating the account needs the link **and** the PIN. The database stores only a hash and discards the PIN after checking. Older patients can get one with "Create a claim PIN".

**Password reset**: "Forgot password?" on the patient and physio sign-in. It emails a reset link; the page that opens asks for a new password.

**Real dates**: patient phones and the live clinic always use the real date. The demo keeps its own demo calendar.

**Turn it on**
1. Supabase SQL Editor: run `supabase/schema-v4.sql` (after v1 to v3; safe to run again).
2. Supabase Authentication, URL Configuration: set **Site URL** to your GitHub Pages address (password-reset links return there).
3. Merge, run `node scripts/build.mjs`, commit `docs/`.
4. Open the Physio dashboard, Clinic settings: set the retention period and the clinic contact.

**Limits (be honest)**
- `schema-v4.sql` has not been run on a real Postgres. Tested against the fake server and a headless browser.
- Supabase's built-in email sender allows only a few emails per hour. Use your own SMTP for real use.
- Deleting a login uses a database function that removes the user from Supabase Auth. If it fails, remove the user under Authentication, Users.
- Not covered: breach notification process, children's data (verifiable parental consent for under-18s), a formal grievance workflow, audit of who read what, encryption beyond what Supabase provides, data kept in browser storage on shared devices, backups held by Supabase after erasure.
- The retention default is a starting point, not advice. Hindi and Bengali strings are machine-drafted: **NEEDS_NATIVE_REVIEW**, and the notice needs legal review.
- Prototype only. Do not use real patient data until a lawyer and the physio have signed off.


## Demo and live clinic (Phase 6.5)

One website, two modes that never share data:
- **Demo** (the default): the six made-up patients, the demo bar, fast-forward. The six built-in patients never leave the device. A patient you add in the demo gets a sync key like a live one (sign in as a physio on the dashboard tab first), so a real phone can join the demo; it is flagged `demoPatient` and never carried into the live clinic. Reset erases those patients' cloud copies (best effort, needs sign-in). A "Go to live clinic" button is on the demo bar.
- **Live clinic**: the running app. Real patients only, real dates, cloud sync. Nothing is shown until the physio signs in. Tabs: *Physio dashboard* and *View as patient*. The preview shows a patient's phone screen exactly as they see it, **read-only** (the preview is inert: nothing tapped there changes the record).
- Switch with the buttons at the top, or by opening `#live` or `#demo` on the site address.
- The first time you open the live clinic, your real patients (the ones with a sync link) are carried over from the old shared store. Demo patients are never carried over. The demo and live stores are separate in the browser (`rehabpath-v1` and `rehabpath-live-v1`).

**Patients**: a phone that opens an invite link (or `#signin`) becomes a patient device with its **own store** (`rehabpath-patient-v1`). It shows only that patient's screens, with no demo bar, no dashboard and no preview. Opening a patient's link on the physio's own browser also makes that browser a patient device; the physio's data is untouched, and `#reset-device` returns to the physio view. Use a private window to try links.

**Patient link and QR code**: every patient card has a "Patient link and QR code" section at the top, available at any time (not just when the patient is created), with the claim PIN if one is set.

**Limits**
- Signing out of the live clinic hides the patients but their data stays in that browser's storage. On a shared computer, clear the site data.
- The preview shows the patient's plan as the physio's computer has it, which is what the phone shows after a sync.

### Phase 7.4 — Quick check-in shortcuts

- **Exercises step:** an "✓ I did them all" button marks every prescribed exercise done in one tap. Individual exercises can still be changed afterwards.
- **Warning signs step:** a "None of these" button answers every unanswered sign "No". It is hidden once the patient has tapped "Yes" on any sign, and it never touches a sign the voice input only *suggested* as "Yes" — the patient must still tap those themselves, so the app never answers a safety question on its own.
- Labels in English, Hindi and Bengali (Hindi/Bengali still need native-speaker review). Tests: `tests/quick-checkin.test.ts`.

## WhatsApp channel

Demo: yellow bar, **WhatsApp** shows a simulated chat of the daily check-in. Live: **WhatsApp** tab has setup, templates, numbers and consent; sending stays off until a number is connected. See [WHATSAPP.md](WHATSAPP.md).

## Guided sessions and form-check videos

**Guided session** (patient Home, "Start my exercises"): one exercise at a time with its picture and demo video, set and rep counting, hold timer, rest between sets, optional voice, "Stop, it hurts" (with the protocol's own skip reasons), "I need help", and an optional 0 to 10 pain score after each exercise. Today's session pre-fills the exercise answers of the daily check-in, only where the patient has not answered yet. The app counts taps; it never says a movement is correct, and a session never changes a tier or a plan. The physio sees a read-only "Guided sessions" card. Code: `src/session/`, `src/ui/GuidedSession.tsx`.

**Form-check video** ("Ask my physio about an exercise", or "I need help" inside a session): the patient ticks a consent, records or picks a short clip, adds a note and sends. The physio sees a worklist chip, watches the clip, ticks cues, writes a reply, or deletes the clip. The review time shown is the protocol's own REVIEW response time (nothing new invented). A video request is not a way to report a warning sign; the screens say so and point to 112. It never changes a tier or a plan. Code: `src/forms/`, `src/ui/FormRequest.tsx`, `src/ui/FormReview.tsx`.

**Where clips live.** With live sync and `supabase/schema-form-clips.sql` applied, clips go to a **private** bucket `form-clips` (25 MB, MP4/WebM/MOV, folder = the patient's sync key) and the physio plays them through a 10-minute signed address. Without that, the clip stays on the patient's phone (IndexedDB), the physio sees the request and note but not the video, and the patient is told so. **Retention:** a clip is deleted 30 days after it was sent, or 7 days after the physio replies, whichever is first; either side can delete it at once; erasing a patient in the clinic also erases their cloud clips. A deletion on either side always wins when the two sides sync.

**Placeholders to confirm** (all marked in code): clip retention days (30 / 7), maximum clip size (25 MB), rest between sets (30 s), the generic form cues (`CUES` in `src/forms/model.ts`), and the Hindi and Bengali wording of the session, video and consent text (`NEEDS_NATIVE_REVIEW`). **The consent wording is a draft and needs a lawyer before real patients use it.**

**Not tested for real.** Unit tests use a fake server for the cloud calls; the SQL and the Storage calls have not been run against a live Supabase project. The one thing to check in a staging project first: that `request_sync_key()` (reads the `x-sync-key` header) works for Storage uploads from a patient on the plain link. If it does not, uploads from link-only patients return 403 and an upload edge function is needed. Phone video capture (`<input capture>`) and playback were not tried on an iPad or iPhone. On the patient's own phone, a clip kept on the device is removed by the retention rule or the delete button, but is not removed when the clinic erases the patient (the clinic cannot reach that phone).
