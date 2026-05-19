/**
 * Smoke test that React + DOM work in vitest browser mode.
 * Verifies the foundation that <Canvas> (phase 9) will sit on.
 */
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'vitest'

describe('@canvas-harness/react (browser)', () => {
  test('react can mount into the DOM', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)
    await act(async () => {
      root.render(
        <StrictMode>
          <span data-testid="probe">hello</span>
        </StrictMode>,
      )
    })

    const probe = container.querySelector('[data-testid="probe"]')
    expect(probe?.textContent).toBe('hello')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
