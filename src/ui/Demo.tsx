import { useEffect, useState } from 'react';
import type { ExerciseDemo, Lang, Patient } from '../types';
import { t } from '../i18n';
import { classifyLink, demoFor } from '../exercises/demos';
import { loadLocalVideo } from '../exercises/deviceVideos';
import { exerciseName } from '../exercises/library';

/** Plays the physio's demonstration: YouTube inside the app (no cookies), a video file in a player, any other link opens in the browser. */
export function DemoPlayer({ demo, lang, onClose }: { demo: ExerciseDemo; lang: Lang; onClose: () => void }) {
  const T = (k: string) => t(lang, k);
  const [src, setSrc] = useState<string | null>(demo.kind === 'video' ? demo.url : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (demo.kind !== 'local') return;
    let url: string | null = null;
    let live = true;
    void loadLocalVideo(demo.id).then((b) => { if (!live) return; if (b) { url = URL.createObjectURL(b); setSrc(url); } else setFailed(true); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [demo]);
  const kind = demo.kind === 'link' ? classifyLink(demo.url) : null;
  // The address a <video> element should play, if this demo is a video at all.
  const fileSrc = demo.kind === 'link' ? (kind?.type === 'file' ? demo.url : null) : src;
  return (
    <div className="demoplayer" role="region" aria-label={T('demoFrom')}>
      <p className="demofrom">{T('demoFrom')}</p>
      {kind?.type === 'youtube' && (
        <div className="demoframe"><iframe src={kind.embed} title={T('demoWatch')} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation" /></div>
      )}
      {fileSrc && !failed && <video className="demovideo" controls playsInline preload="metadata" src={fileSrc} onError={() => setFailed(true)} />}
      {demo.kind === 'link' && kind?.type === 'external' && <a className="demolink" href={demo.url} target="_blank" rel="noopener noreferrer">{T('demoOpen')} ↗</a>}
      {failed && <p className="hint" role="status">{demo.kind === 'local' ? T('demoMissing') : T('demoNoPlay')}</p>}
      <button type="button" className="democlose" onClick={onClose}>{T('demoClose')}</button>
    </div>
  );
}

/** The "Watch how to do it" button for one exercise. Renders nothing when the physio has not attached a demonstration. */
export function DemoButton({ patient, exerciseId, lang, compact }: { patient: Patient; exerciseId: string; lang: Lang; compact?: boolean }) {
  const demo = demoFor(patient, exerciseId);
  const [open, setOpen] = useState(false);
  if (!demo) return null;
  return (
    <div className="demo">
      <button type="button" className="demobtn" aria-expanded={open} aria-label={t(lang, 'demoWatchLabel', { name: exerciseName(exerciseId, lang) })} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">▶</span> {t(lang, compact ? 'demoWatchShort' : 'demoWatch')}
      </button>
      {open && <DemoPlayer demo={demo} lang={lang} onClose={() => setOpen(false)} />}
    </div>
  );
}
