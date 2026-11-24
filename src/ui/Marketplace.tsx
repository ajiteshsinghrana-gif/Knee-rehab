import { useState, useSyncExternalStore } from 'react';
import { getState, subscribe, clockMs } from '../store';
import { getMode } from '../mode';
import { LANGS, LANG_NAME, type Lang } from '../types';
import { getMp, subscribeMp } from '../marketplace/store';
import { PatientFlow } from './MarketplacePatient';
import { PhysioPortal } from './MarketplacePhysio';
import { Admin } from './MarketplaceAdmin';
import { ViewSwitch } from './TopBar';
import { tr } from '../marketplace/strings';

type Sub = 'find' | 'portal' | 'admin';

/** The Marketplace tab: screening-first discovery and booking for patients, a portal for physios, and the platform's own view. */
export function Marketplace() {
  const app = useSyncExternalStore(subscribe, getState);
  const mp = useSyncExternalStore(subscribeMp, getMp);
  const [sub, setSub] = useState<Sub>('find');
  const [lang, setLang] = useState<Lang>('en');
  const live = getMode() === 'live';
  const nowIso = new Date(clockMs(app)).toISOString();
  return (
    <main className="mp" data-testid="marketplace">
      <div className="mp-head">
        <ViewSwitch<Sub> label="Marketplace views" value={sub} onChange={setSub} options={[
          { id: 'find', label: 'Find a physio (patient)', short: 'Patient', testid: 'mp-tab-find' },
          { id: 'portal', label: 'Physio portal', short: 'Physio', testid: 'mp-tab-portal' },
          { id: 'admin', label: 'Admin and revenue', short: 'Admin', testid: 'mp-tab-admin' },
        ]} />
        {sub === 'find' && (
          <label className="mp-lang">Language
            <select value={lang} data-testid="mp-lang" onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{LANG_NAME[l]}</option>)}</select></label>
        )}
      </div>
      {sub === 'find' && <PatientFlow lang={lang} today={app.today} nowIso={nowIso} />}
      {sub === 'portal' && <PhysioPortal mp={mp} today={app.today} />}
      {sub === 'admin' && <Admin mp={mp} live={live} />}
      {!live && <p className="notice left">{tr('demoNote', sub === 'find' ? lang : 'en')}</p>}
    </main>
  );
}
