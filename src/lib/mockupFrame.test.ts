import { describe, expect, it } from 'bun:test'
import { isMockupFrameRequested } from './mockupFrame'

describe('isMockupFrameRequested', () => {
  it('uses the full viewport when the parameter is absent', () => {
    expect(isMockupFrameRequested('')).toBe(false)
    expect(isMockupFrameRequested('?path=home%2Fenrico')).toBe(false)
  })

  it('renders the mockup for ?mockup=1', () => {
    expect(isMockupFrameRequested('?mockup=1')).toBe(true)
    expect(isMockupFrameRequested('?path=home%2Fenrico&mockup=1')).toBe(true)
  })

  it('accepts true and rejects every other value', () => {
    expect(isMockupFrameRequested('?mockup=true')).toBe(true)
    expect(isMockupFrameRequested('?mockup=0')).toBe(false)
    expect(isMockupFrameRequested('?mockup=false')).toBe(false)
    expect(isMockupFrameRequested('?mockup=')).toBe(false)
    expect(isMockupFrameRequested('?mockup')).toBe(false)
  })
})
