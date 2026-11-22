# WhatsApp channel

Patients get reminders on WhatsApp and can answer the daily check-in there. Triage is unchanged: the chat asks the questions of the patient's protocol pack, builds the same check-in as the app, and the same rules judge it. No AI chooses any question, answer or tier.

## What is built (works today, no WhatsApp number needed)

| Where | What |
|---|---|
| Demo, yellow bar, **💬 WhatsApp** | A simulated WhatsApp chat for the selected patient, in English, Hindi or Bengali. It runs the real check-in logic. A tick-box can also save the answers to the patient, so the Physio dashboard reacts (for example a "Yes" to chest pain turns the patient SAFETY). Reset undoes it. Nothing is sent. |
| Live clinic, **WhatsApp** tab | Setup checklist, the five templates to submit to Meta (with Hindi and Bengali), each patient's number and consent, a chat preview that never saves anything, and a **Send test** button that stays off until a backend reports WhatsApp is connected. |
| `src/whatsapp/flow.ts` | The conversation as pure, tested logic (no network). |
| `supabase/functions/whatsapp/` | Backend scaffold: webhook handshake, signature check, status, and sending one approved template. **Not tested against Meta** (no number yet). |

## What is not built yet (needs the number to test)

1. Receiving a reply and matching it to a patient (phone number to patient, stored in the cloud with RLS like the other tables).
2. Running `flow.ts` on the server for each incoming tap, then saving the check-in to the patient's synced record.
3. The reminder schedule (morning nudge, missed check-in ladder) and delivery or read receipts.
4. Escalation to the physio on WhatsApp (an alert template and an acknowledgement time in the audit log).
5. The 24-hour customer-reply window: after 24 hours of silence only templates can be sent.

## Getting a number and connecting it

1. Create a Meta Business account and complete business verification (business.facebook.com).
2. In the Meta developer console create an app and add the WhatsApp product. Add a phone number that is not already on a normal WhatsApp account.
3. Choose how to send: Meta's Cloud API directly, or a partner (Gupshup, Twilio, Interakt). Compare current India prices and approval time before deciding. Do not rely on any price quoted in a pitch without checking.
4. In WhatsApp Manager submit the templates from the live **WhatsApp** tab. Use the category "utility". Approval can take days.
5. Set the backend secrets and deploy the function:
   ```
   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=<long random string> WHATSAPP_APP_SECRET=...
   supabase functions deploy whatsapp --no-verify-jwt
   ```
6. In Meta, set the webhook callback URL to `https://<project>.supabase.co/functions/v1/whatsapp` and the same verify token. Subscribe to "messages".
7. Reopen the live **WhatsApp** tab: the status card should say Connected. Add a number with consent for yourself and press **Send test**.

## Rules the channel follows

- No clinical detail in a message (shared phones, lock screens): "time for your check-in", never the condition.
- Patient's (or caregiver's) agreement is recorded before any message. "Who is replying" is asked in the chat and stored as in the app.
- Warning-sign wording is the app's own safety text. It still needs physio sign-off (see README).
- Free text and voice notes would be kept for the physio and never interpreted.
- Take legal advice on DPDP consent and data storage before real patients.

## Needs a native reader before real use (NEEDS_NATIVE_REVIEW)

Hindi and Bengali wording in `src/whatsapp/strings.ts` and `src/whatsapp/templates.ts`. Reminder times and any escalation timings are placeholders for the physio to set.
