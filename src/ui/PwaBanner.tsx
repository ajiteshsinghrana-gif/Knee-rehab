import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Lang } from '../types';
import { t } from '../i18n';
import { getState } from '../store';
import { isPatientDevice } from '../device';
import { applyUpdate, dismissOfflineReady, getPwaStatus, subscribePwa } from '../pwa/status';

/** A patient's own language on a patient phone; English on the physio's screen (the physio dashboard is English only). */
const bannerLang = (): Lang => {
  if (!isPatientDevice()) return 'en';
  const st = getState();
  return (st.patients.find((p) => p.id === st.activeId) ?? st.patients[0])?.language ?? 'en';
};

/** Bottom bar for the offline copy of the app (Phase 7.3): "no internet" while offline, "update now" when a newer version is waiting. */
export function PwaBanner() {
  const s = useSyncExternalStore(subscribePwa, getPwaStatus);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const lang = bannerLang();
  if (!s.updateReady && !s.offlineReady && online) return null;
  return (
    <div className="pwabar" data-testid="pwa-bar">
      {s.updateReady && (
        <div className="pwarow" role="status">
          <span>{t(lang, 'pwaUpdate')}</span>
          <button type="button" className="btn primary" data-testid="pwa-update" onClick={applyUpdate}>{t(lang, 'pwaUpdateNow')}</button>
        </div>
      )}
      {!online && <div className="pwarow" role="status" data-testid="pwa-offline"><span>{t(lang, 'pwaOffline')}</span></div>}
      {s.offlineReady && online && !s.updateReady && (
        <div className="pwarow" role="status">
          <span>{t(lang, 'pwaReady')}</span>
          <button type="button" className="btn" onClick={dismissOfflineReady}>{t(lang, 'pwaOk')}</button>
        </div>
      )}
    </div>
  );
}
