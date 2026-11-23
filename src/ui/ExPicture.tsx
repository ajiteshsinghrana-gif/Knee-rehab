/**
 * Exercise picture. The shipped pictures (media/*.svg) are emoji placeholders, so until real pictures exist
 * every exercise shows the same neutral line icon. A real picture (any other file) is shown as it is.
 */
const isPlaceholder = (src: string) => /^media\/[^/]+\.svg$/.test(src);

export function ExPicture({ src, size }: { src: string | undefined; size: number }) {
  if (src && !isPlaceholder(src)) return <img className="expic" src={src} alt="" width={size} height={size} />;
  return (
    <span className="expic placeholder" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13" cy="4.5" r="2" />
        <path d="M9 21l2.5-6.5L14 16v5" />
        <path d="M7 11l3.5-3.5 3 1.5 2.5 3.5" />
        <path d="M11.5 14.5l1.5-6" />
      </svg>
    </span>
  );
}
