import type { SVGProps } from 'react'

/** Inline vector icons avoid platform-dependent Unicode media glyphs. */
export function VideoImageIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8" cy="8" r="1.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m4 17 5-5 4 4 3-3 4 4" />
  </svg>
}
export function VideoFilmIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path strokeLinecap="round" d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M7 12h10" />
  </svg>
}
export function VideoAudioIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5l11-2v13M9 8l11-2" />
    <ellipse cx="6" cy="18" rx="3" ry="2.5" />
    <ellipse cx="17" cy="16" rx="3" ry="2.5" />
  </svg>
}
