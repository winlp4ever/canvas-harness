/**
 * Tiny status badge showing the persistence state from
 * `useDebouncedSave`. Demo chrome — not part of the library.
 */
import { useEffect, useState } from 'react'
import type { SaveStatus as Status } from '../hooks/useDebouncedSave'

const formatSince = (ts: number, now: number): string => {
  const sec = Math.floor((now - ts) / 1000)
  if (sec < 1) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  return `${min}m ago`
}

const labelFor = (status: Status, now: number): { text: string; color: string; bg: string } => {
  switch (status.kind) {
    case 'idle':
      return { text: 'no changes', color: '#64748b', bg: '#f1f5f9' }
    case 'pending':
      return { text: 'pending…', color: '#92400e', bg: '#fef3c7' }
    case 'saving':
      return { text: 'saving…', color: '#1e40af', bg: '#dbeafe' }
    case 'saved':
      return { text: `saved ${formatSince(status.at, now)}`, color: '#166534', bg: '#dcfce7' }
    case 'error':
      return { text: `error: ${status.message}`, color: '#7f1d1d', bg: '#fee2e2' }
  }
}

export function SaveStatus({ status }: { status: Status }) {
  // Tick once per second so "saved 3s ago" updates live.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (status.kind !== 'saved') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [status.kind])

  const { text, color, bg } = labelFor(status, now)
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: bg,
        color,
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: 500,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  )
}
