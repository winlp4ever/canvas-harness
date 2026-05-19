import { type CanvasStore, installExtension } from '@canvas-harness/core'
import { useEffect, useRef, useState } from 'react'
import { createSnapToGrid } from '../extensions/snap-to-grid'

/**
 * Tray for toggling the example snap-to-grid extension. Demonstrates
 * the install/uninstall lifecycle.
 */
export function ExtensionsMenu({ store }: { store: CanvasStore }) {
  const [snapOn, setSnapOn] = useState(false)
  const uninstallRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (snapOn) {
      uninstallRef.current = installExtension(store, createSnapToGrid(20))
      return () => {
        uninstallRef.current?.()
        uninstallRef.current = null
      }
    }
    return undefined
  }, [snapOn, store])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        padding: 4,
        background: '#fff',
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        zIndex: 10,
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
        <input type="checkbox" checked={snapOn} onChange={e => setSnapOn(e.target.checked)} />
        snap-to-grid (20px)
      </label>
    </div>
  )
}
