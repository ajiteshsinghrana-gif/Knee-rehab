/**
 * Guided-session settings. These only pace the session: they never change a plan or a triage tier.
 * restSec is a guide for the patient (they can skip it). NEEDS_PHYSIO_SIGNOFF: the physio should confirm or change it.
 */
export const SESSION_CONFIG = {
  restSec: 30,
  /** Sessions kept on a patient record. */
  keepSessions: 60,
} as const;
