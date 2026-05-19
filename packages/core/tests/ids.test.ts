import { describe, expect, test } from 'vitest'
import { makeIdGenerator, randomClientId } from '../src/ids'
import { asClientId } from '../src/types'

describe('ids', () => {
  test('randomClientId produces "u-XXXX" format', () => {
    const id = randomClientId()
    expect(id).toMatch(/^u-[0-9a-f]{4}$/)
  })

  test('makeIdGenerator produces unique monotonic ids prefixed by clientId', () => {
    const gen = makeIdGenerator(asClientId('u-test'))
    const ids = [gen(), gen(), gen()]
    expect(ids).toEqual(['u-test-0', 'u-test-1', 'u-test-2'])
    expect(new Set(ids).size).toBe(3)
  })

  test('two generators with different clients never collide', () => {
    const a = makeIdGenerator(asClientId('u-a'))
    const b = makeIdGenerator(asClientId('u-b'))
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(a())
      ids.add(b())
    }
    expect(ids.size).toBe(200)
  })
})
