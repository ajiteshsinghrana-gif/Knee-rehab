/** The animated demo for an exercise: media/gif/<id>.gif beside its picture file (media/<id>.svg). Drop a licensed GIF of the same name over ours to replace it. */
export function gifFor(picture: string | undefined): string | undefined {
  const m = picture?.match(/^(.*\/)?([^/]+)\.svg$/);
  return m ? `${m[1] ?? ''}gif/${m[2]}.gif` : undefined;
}
