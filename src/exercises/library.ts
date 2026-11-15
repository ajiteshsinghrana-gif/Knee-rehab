import type { Exercise, Lang } from '../types';
import raw from './library.json';

export const LIBRARY: Exercise[] = raw as unknown as Exercise[];
const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
export const getExercise = (id: string): Exercise | undefined => BY_ID.get(id);
/** Display name; unknown ids (old history) fall back to the raw id. */
export const exerciseName = (id: string, lang: Lang): string => {
  const e = BY_ID.get(id);
  return e ? e.name[lang] || e.name.en : id;
};
