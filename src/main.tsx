import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { getState, realToday, refreshToday, setState, subscribe } from './store';
import { startSync } from './sync/engine';
import { setAuthScope } from './sync/auth';
import { isPatientDevice, onlyOwnPatients, setPatientDevice, wantsDeviceReset, wantsPatientMode } from './device';
import './ui/base.css';
import './ui/extra.css';

// A phone that opens an invite or sign-in link becomes a patient device (Phase 6.3): no physio dashboard, no demo controls.
if (wantsDeviceReset(window.location.hash)) { setPatientDevice(false); window.location.hash = ''; }
if (wantsPatientMode(window.location.hash)) setPatientDevice(true);
if (isPatientDevice()) { setAuthScope('patient'); setState({ ...onlyOwnPatients(getState()), live: true, today: realToday() }); } // a patient's phone uses the real date
refreshToday();
setInterval(refreshToday, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });

createRoot(document.getElementById('root')!).render(<App />);

// Live sync starts only when sync.json has a Supabase URL and key; otherwise the app is exactly as before.
void startSync(getState, setState, subscribe);
