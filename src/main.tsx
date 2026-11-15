import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { getState, setState, subscribe } from './store';
import { startSync } from './sync/engine';
import './ui/base.css';
import './ui/extra.css';

createRoot(document.getElementById('root')!).render(<App />);

// Live sync starts only when sync.json has a Supabase URL and key; otherwise the app is exactly as before.
void startSync(getState, setState, subscribe);
