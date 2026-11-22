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

### 3b. The physio replaces a placeholder curve (45 s)
Still on **Kamla**. Her knee-bend chart shows "Placeholder curve: not clinically validated, awaiting physio sign-off", and the alert is only as good as that curve.
1. In **Expected recovery curves**, press **Edit** on knee bend.
2. Change the points (for example 0 wk: 40, 2: 50, 6: 66, 12: 85), choose **All patients with this condition**, type the source as the reason, and save.
3. The chart note now says who set the curve and why, the alert clears, and every knee replacement patient's audit log has the entry.
Say: "The demo curves are placeholders and the app says so. The physio replaces them with his protocol's numbers, once, for the whole clinic."

### 3c. The physio shows the ideal way to do an exercise (30 s)
Physio dashboard, **🎬 Exercise videos**. Find **Ankle pumps**, press **Add video or link**, paste a YouTube link and save. (Upload also works; signed out, the video stays on this device.)
Then **Patient phone**, patient **Kamla**: her exercise list now shows **▶ देखें** next to Ankle pumps, and the same button appears on its card in the daily check-in.
Say: "The physio records the ideal movement once; every patient with that exercise can watch it in their own language."

## 4. The patient is told (45 s)
Switch to **Patient phone**, patient Kamla. The home screen shows "Message from your physio" in Hindi, with a read-aloud button. Kamla's daughter answers for her: tick "I am answering for Kamla" (already on); every question has a read-aloud button; the physio screen shows "7 of the last 7 check-ins were answered by a caregiver".

## 5. Third language and a different condition (45 s)
Patient phone, patient **Imran** (shoulder surgery, Bengali). Same app, different protocol: sling phase, arm-raise measured on a photo. The language button cycles English, हिन्दी, বাংলা.

## 6. Any condition (30 s)
Physio dashboard, **+ Add a condition**: the physio writes a protocol for any condition, with phases, measures, warning signs and gates. Nothing is invented: every number he types is tagged as his own, and any placeholder is listed for sign-off.

## If asked
- **Why not an AI chatbot?** Safety. Triage is rules only, so every flag can be explained and checked.
- **What is not clinically signed off?** Every `NEEDS_PHYSIO_SIGNOFF` value, including all three conditions' expected recovery curves; the README lists them. The Bengali wording also needs a native reader.
- **What is not built yet?** Backend, login and live sync (Phase 6). Photos are not uploaded; they stay on the phone.

## Optional: live sync (only if Supabase is set up)
Add a patient, open the invite link on a phone, do a check-in. The physio screen shows it within about 10 seconds ("Live sync on" chip). Change the plan on the physio screen: the patient sees the notice, but not your reason.


## Optional: WhatsApp (45 s)

Yellow demo bar, **💬 WhatsApp**. Say: "This is how the patient answers on WhatsApp. Same questions, same rules." Tap through, answer Yes to chest pain, and show the red message. Leave the "also save" box unticked unless you want the dashboard to react (Reset undoes it). It is a simulation: no number is connected yet.

## Optional: guided session and a video request (60 s; rehearse first)

Patient screen: **Start my exercises**. Tap through one exercise (Rep done, rest, pain 0 to 10), then **I need help**, tick the consent and pick any short video. Say: "The patient asks the physio to look at it, with consent." Switch to the Physio tab: a **📹 1 video to review** chip; open it, tick a cue, write a reply, **Send reply**. Back on the patient screen the reply shows under **My videos**. In the demo (no cloud) the clip stays on the device and the physio card says so: say that, do not imply it was uploaded. Not tested on a real phone or iPad: do not use in front of the investor unless rehearsed on that device. Reset undoes it.
