import { useId } from 'react'

export default function GeminiLogo({ className = 'h-5 w-5' }: { className?: string }) {
  const gradientId = useId()
  return <svg role="img" aria-label="Gemini Logo" viewBox="0 0 24 24" className={className}>
    <defs><linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4285f4" /><stop offset="0.5" stopColor="#9b72cb" /><stop offset="1" stopColor="#d96570" /></linearGradient></defs>
    <path fill={`url(#${gradientId})`} d="M12 0C10.5 7.5 7.5 10.5 0 12c7.5 1.5 10.5 4.5 12 12 1.5-7.5 4.5-10.5 12-12C16.5 10.5 13.5 7.5 12 0Z" />
  </svg>
}
