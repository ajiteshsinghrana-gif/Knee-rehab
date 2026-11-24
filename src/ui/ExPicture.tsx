import { useState } from 'react';
import { gifFor } from '../exercises/gif';

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Exercise picture: the exercise's own picture file (media/*.svg), one per exercise. With `animated`, the demo GIF instead (falls back to the picture if there is none, or the person asked for less motion). */
export function ExPicture({ src, size, animated }: { src: string | undefined; size: number; animated?: boolean }) {
  const [bad, setBad] = useState(false);
  if (!src) return <span className="expic placeholder" style={{ width: size, height: size }} aria-hidden />;
  const gif = animated && !bad && !reduceMotion() ? gifFor(src) : undefined;
  return <img className={gif ? 'expic expic-gif' : 'expic'} src={gif ?? src} alt="" width={size} height={size} style={gif ? { width: size, height: size } : undefined} onError={gif ? () => setBad(true) : undefined} />;
}
