import { describe, expect, test } from 'bun:test'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { failureStatusAndMessage } from '../../server/routes/failures'
import {
  CONFINEMENT_BADGE_LABEL,
  confinementRefusalMessage,
  isConfinementBlocked,
} from './confinement'

function entry(overrides: Partial<DirectoryEntry> & { name: string }): DirectoryEntry {
  return {
    kind: 'file',
    sizeBytes: null,
    childCount: null,
    isExecutable: false,
    isHidden: false,
    isSymlink: false,
    isGitignored: false,
    escapesRoot: false,
    ...overrides,
  }
}

describe('isConfinementBlocked', () => {
  test('blocks an entry whose target leaves the root', () => {
    expect(isConfinementBlocked(entry({ name: 'escape', isSymlink: true, escapesRoot: true }))).toBe(
      true,
    )
  })

  test('leaves an ordinary entry and a contained symlink alone', () => {
    expect(isConfinementBlocked(entry({ name: 'notes.txt' }))).toBe(false)
    expect(isConfinementBlocked(entry({ name: 'link', isSymlink: true }))).toBe(false)
  })
})

describe('confinementRefusalMessage', () => {
  const message = confinementRefusalMessage('escaping-directory')

  test('names the entry the user acted on', () => {
    expect(message).toContain('escaping-directory')
  })

  test('says it is a rule, not a malfunction', () => {
    expect(message).toStartWith('not allowed:')
    expect(message).toContain('symlink pointing outside the served root')
  })

  test('the badge is short enough to ride on a tree row', () => {
    expect(CONFINEMENT_BADGE_LABEL.length).toBeLessThanOrEqual(16)
  })
})

// The client refuses a blocked row locally and the server refuses the same row
// with a 403; a user who meets both (clicking, then a direct request) must not
// be told two different stories.
describe('client and server refusals agree', () => {
  const serverRefusal = failureStatusAndMessage('symlink-escapes-root', 'escaping-file')

  test('the server refuses with 403, not a bad-request', () => {
    expect(serverRefusal.statusCode).toBe(403)
  })

  test('both open with the same verdict and name the same entry', () => {
    expect(serverRefusal.message).toStartWith('not allowed:')
    expect(serverRefusal.message).toContain('escaping-file')
    expect(confinementRefusalMessage('escaping-file')).toStartWith('not allowed:')
  })
})
