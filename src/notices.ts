/** Patient-facing wording for a physio review (Phase 2.6). Plain text so it can be read aloud. */
import type { Lang, Notice, NoticeChange, ProtocolPack } from './types';
import { exerciseName } from './exercises/library';
import { L, t } from './i18n';

const fmtDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

export function changeText(c: NoticeChange, lang: Lang, pack: ProtocolPack): string {
  switch (c.kind) {
    case 'regress': return t(lang, 'change_regress', { from: exerciseName(c.from, lang), to: exerciseName(c.to, lang) });
    case 'restore': return t(lang, 'change_restore', { exercise: exerciseName(c.exercise, lang) });
    case 'hold': return t(lang, 'change_hold');
    case 'release': return t(lang, 'change_release');
    case 'followUp': return c.nextReviewDate
      ? t(lang, 'change_followUp', { n: c.checkInEveryDays, date: fmtDate(c.nextReviewDate) })
      : t(lang, 'change_followUp_nodate', { n: c.checkInEveryDays });
    case 'exercises': {
      const parts = [
        ...(c.added.length ? [t(lang, 'change_exAdded', { list: c.added.map((id) => exerciseName(id, lang)).join(', ') })] : []),
        ...(c.removed.length ? [t(lang, 'change_exRemoved', { list: c.removed.map((id) => exerciseName(id, lang)).join(', ') })] : []),
      ];
      return t(lang, 'change_exercises', { parts: parts.join('; ') });
    }
    case 'phase': return t(lang, 'change_phase', { phase: L(pack.phases.find((x) => x.id === c.phaseId)?.name, lang) || c.phaseId });
  }
}

export function noticeText(n: Notice, lang: Lang, pack: ProtocolPack): string {
  const what = n.changes.map((c) => changeText(c, lang, pack)).join(t(lang, 'noticeAnd'));
  return t(lang, 'noticeLine', { date: fmtDate(n.at), what });
}
