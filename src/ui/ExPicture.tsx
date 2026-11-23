/** Exercise picture: the exercise's own picture file (media/*.svg), one per exercise. */
export function ExPicture({ src, size }: { src: string | undefined; size: number }) {
  if (!src) return <span className="expic placeholder" style={{ width: size, height: size }} aria-hidden />;
  return <img className="expic" src={src} alt="" width={size} height={size} />;
}
