import type { Exercise, Lang } from '../types';
import raw from './library.json';
import { L } from '../i18n';

export const LIBRARY: Exercise[] = raw as unknown as Exercise[];
const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
export const getExercise = (id: string): Exercise | undefined => BY_ID.get(id);
/** Physio-written exercises (Phase 3.3) join the shared library. Shipped exercises cannot be replaced. */
export function registerExercise(e: Exercise): void {
  if (BY_ID.has(e.id)) throw new Error(`Exercise ${e.id} already exists`);
  LIBRARY.push(e);
  BY_ID.set(e.id, e);
}
export function unregisterExercise(id: string): void {
  const i = LIBRARY.findIndex((x) => x.id === id);
  if (i >= 0) LIBRARY.splice(i, 1);
  BY_ID.delete(id);
}
/** Display name; unknown ids (old history) fall back to the raw id. */
export const exerciseName = (id: string, lang: Lang): string => {
  const e = BY_ID.get(id);
  return e ? L(e.name, lang) : id;
};
