import { describe, expect, test } from 'vitest'
import { VERSION } from '../src/index'

describe('@canvas-harness/core', () => {
  test('exports VERSION', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
