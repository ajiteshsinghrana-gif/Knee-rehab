# Demo script (about 4 minutes)

Open the app. Six demo patients are loaded; the yellow demo bar sits at the top. **Reset** restores everything.

## 1. The worklist (30 s)
Physio dashboard. Patients are sorted by urgency, and every flag shows the rule that raised it.
- **Meera**: SAFETY (red-flag symptom and rising pain), overdue.
- **Arjun**: REVIEW, missed sessions. **Kamla**: REVIEW, knee bend below the expected curve. **Imran**: REVIEW, took his arm out of the sling.
- **Ravi, Sana**: on plan.
Say: "No AI decides this. Each tier comes from a rule in the condition's protocol, and each threshold shows its source."

## 2. Ravi drifts into URGENT (60 s)
Press **Fast-forward** three times. Each press adds a day of Ravi's check-ins (pain rises, he skips, same movement hard again). After the third he becomes URGENT through the "several amber signals together" rule. Open his card: **Why this tier** shows the signals.

## 3. Physio changes the treatment himself (60 s)
Open **Kamla** (knee replacement, below the curve).
1. **Adjust the treatment yourself**, choose "Add an exercise", pick one, try to apply with no reason: the button stays disabled.
2. Type a reason, apply. It appears in the audit log as "physio-initiated".
3. Choose "Move to a phase": a warning lists the unmet gate criteria and asks him to confirm he is overriding the protocol.
Say: "He is never blocked, but every change is deliberate, explained and recorded."

## 4. The patient is told (45 s)
Switch to **Patient phone**, patient Kamla. The home screen shows "Message from your physio" in Hindi, with a read-aloud button. Kamla's daughter answers for her: tick "I am answering for Kamla" (already on); every question has a read-aloud button; the physio screen shows "7 of the last 7 check-ins were answered by a caregiver".

## 5. Third language and a different condition (45 s)
Patient phone, patient **Imran** (shoulder surgery, Bengali). Same app, different protocol: sling phase, arm-raise measured on a photo. The language button cycles English, हिन्दी, বাংলা.

## 6. Any condition (30 s)
Physio dashboard, **+ Add a condition**: the physio writes a protocol for any condition, with phases, measures, warning signs and gates. Nothing is invented: every number he types is tagged as his own, and any placeholder is listed for sign-off.

## If asked
- **Why not an AI chatbot?** Safety. Triage is rules only, so every flag can be explained and checked.
- **What is not clinically signed off?** Every `NEEDS_PHYSIO_SIGNOFF` value; the README lists them. The Bengali wording also needs a native reader.
- **What is not built yet?** Backend, login and live sync (Phase 6). Photos are not uploaded; they stay on the phone.
