import { useEffect, useState } from 'react'

/**
 * Tracks an element's CSS-pixel size via ResizeObserver.
 * Returns { w, h } in CSS pixels; 0/0 until the first observation.
 */
export const useResizeObserver = (ref: React.RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}
