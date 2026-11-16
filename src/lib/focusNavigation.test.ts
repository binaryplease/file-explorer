import { describe, expect, it } from 'bun:test'
import { createInternalFocusNavigation, focusUrlFor } from './focusNavigation'

// The in-memory navigation is the embedded seam; its back-stack is the only
// piece with logic worth pinning (the URL one is a thin wrapper over the
// browser's own history, exercised in the app).
describe('createInternalFocusNavigation', () => {
  it('opens at the seeded focus path', () => {
    const navigation = createInternalFocusNavigation('home/enrico/proj')
    expect(navigation.initialFocusPath()).toBe('home/enrico/proj')
  })

  it('walks pushed focuses back through the subscriber, deepest first', () => {
    const navigation = createInternalFocusNavigation('root')
    const focusChanges: string[] = []
    navigation.subscribe((focusPath) => focusChanges.push(focusPath))

    navigation.push('root/a')
    navigation.push('root/a/b')

    navigation.back()
    navigation.back()

    expect(focusChanges).toEqual(['root/a', 'root'])
  })

  it('stops at the seeded focus and never underflows', () => {
    const navigation = createInternalFocusNavigation('root')
    const focusChanges: string[] = []
    navigation.subscribe((focusPath) => focusChanges.push(focusPath))

    navigation.back()
    navigation.back()

    expect(focusChanges).toEqual([])
  })

  it('reports whether back has somewhere to go', () => {
    const navigation = createInternalFocusNavigation('root')
    expect(navigation.canGoBack()).toBe(false)

    navigation.push('root/a')
    expect(navigation.canGoBack()).toBe(true)

    navigation.back()
    expect(navigation.canGoBack()).toBe(false)
  })

  it('stops notifying a subscriber once it unsubscribes', () => {
    const navigation = createInternalFocusNavigation('root')
    const focusChanges: string[] = []
    const unsubscribe = navigation.subscribe((focusPath) => focusChanges.push(focusPath))

    navigation.push('root/a')
    unsubscribe()
    navigation.back()

    expect(focusChanges).toEqual([])
  })
})

// The URL seam rewrites only `path`; other parameters (the `?mockup=1`
// screenshot flag) survive a focus move so a reload renders the same shell.
describe('focusUrlFor', () => {
  it('writes the focus path exactly as before when nothing else is in the query', () => {
    expect(focusUrlFor('/', '', 'home/a b')).toBe('/?path=home%2Fa%20b')
    expect(focusUrlFor('/', '?path=home', '')).toBe('/')
  })

  it('keeps other query parameters across a focus move', () => {
    expect(focusUrlFor('/', '?mockup=1', 'home')).toBe('/?path=home&mockup=1')
    expect(focusUrlFor('/', '?path=home&mockup=1', 'home/sub')).toBe(
      '/?path=home%2Fsub&mockup=1',
    )
    expect(focusUrlFor('/', '?path=home&mockup=1', '')).toBe('/?mockup=1')
  })
})
