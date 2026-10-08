import { useEffect, useState } from 'react'

export function useMediaBlobUrl(
  id: string | null | undefined,
  loadUrl: (id: string) => Promise<string | undefined>,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    setUrl(null)
    if (!id) return () => undefined

    loadUrl(id).then((nextUrl) => {
      if (active && nextUrl) {
        objectUrl = nextUrl
        setUrl(nextUrl)
      } else if (nextUrl) {
        URL.revokeObjectURL(nextUrl)
      }
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, loadUrl])

  return url
}
