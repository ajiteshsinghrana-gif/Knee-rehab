import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { PwaBanner } from './ui/PwaBanner';
import { registerServiceWorker } from './pwa/register';
import { getState, refreshToday, setState, subscribe } from './store';
import { startSync } from './sync/engine';
import { setAuthScope } from './sync/auth';
import { isPatientDevice, setPatientDevice, wantsDeviceReset, wantsPatientMode } from './device';
import { getMode, modeFromHash, setMode } from './mode';
import './ui/base.css';
import './ui/extra.css';
import './ui/redesign.css';

// A phone that opens an invite or sign-in link becomes a patient device (Phase 6.3): no physio dashboard, no demo controls.
/** Reads the address for device/mode switches. Returns true when something changed (the page then reloads so everything starts clean). */
function applyHash(): boolean {
  const h = window.location.hash;
  if (wantsDeviceReset(h)) { setPatientDevice(false); window.location.hash = ''; return true; }
  if (wantsPatientMode(h)) { const was = isPatientDevice(); setPatientDevice(true); return !was; }
  const wanted = modeFromHash(h);
  if (wanted && !isPatientDevice()) { const was = getMode(); setMode(wanted); window.location.hash = ''; return was !== wanted; }
  return false;
}
applyHash();
if (isPatientDevice()) setAuthScope('patient');
// Opening a link inside a tab that already has the app open only changes the address, so reload when the address switches device or mode.
window.addEventListener('hashchange', () => { if (applyHash()) window.location.reload(); });
refreshToday();
setInterval(refreshToday, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });

createRoot(document.getElementById('root')!).render(<><App /><PwaBanner /></>);
// Offline use and update prompts (Phase 7.3).
registerServiceWorker();

// Live sync starts only when sync.json has a Supabase URL and key; otherwise the app is exactly as before.
// The demo syncs too (Phase 6.9), but only patients added in the demo: the six built-in demo patients have no sync key, so they stay on this device.
void startSync(getState, setState, subscribe);
