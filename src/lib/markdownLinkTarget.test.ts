import { describe, expect, it } from 'bun:test'
import { resolveMarkdownLinkTarget } from './markdownLinkTarget'

const ROOT_PATH = '/srv/served-root'

function resolve(href: string | undefined, documentPath = 'README.md', rootPath: string | null = ROOT_PATH) {
  return resolveMarkdownLinkTarget({ href, documentPath, rootPath })
}

describe('a relative link resolves against the document’s own directory', () => {
  it('opens a sibling of the document — the README/LICENSE case', () => {
    expect(resolve('LICENSE')).toEqual({ kind: 'entry', path: 'LICENSE' })
  })

  it('descends from the document’s directory', () => {
    expect(resolve('docs/Requirements.md')).toEqual({ kind: 'entry', path: 'docs/Requirements.md' })
    expect(resolve('requirements/014.md', 'docs/Requirements.md')).toEqual({
      kind: 'entry',
      path: 'docs/requirements/014.md',
    })
  })

  it('walks up out of the document’s directory', () => {
    expect(resolve('../Requirements.md', 'docs/requirements/014.md')).toEqual({
      kind: 'entry',
      path: 'docs/Requirements.md',
    })
    expect(resolve('../../AGENTS.md', 'docs/requirements/014.md')).toEqual({
      kind: 'entry',
      path: 'AGENTS.md',
    })
  })

  it('accepts the explicit `./` and a trailing slash', () => {
    expect(resolve('./LICENSE')).toEqual({ kind: 'entry', path: 'LICENSE' })
    expect(resolve('docs/requirements/')).toEqual({ kind: 'entry', path: 'docs/requirements' })
  })

  it('reads a leading slash as the served root, not the filesystem root', () => {
    expect(resolve('/docs/Requirements.md', 'docs/requirements/014.md')).toEqual({
      kind: 'entry',
      path: 'docs/Requirements.md',
    })
  })

  it('addresses the served root itself as the empty tree path', () => {
    expect(resolve('.')).toEqual({ kind: 'entry', path: '' })
    expect(resolve('..', 'docs/Requirements.md')).toEqual({ kind: 'entry', path: '' })
  })

  it('resolves against an out-of-root document, which carries an absolute path', () => {
    expect(resolve('sibling.md', '/home/reader/notes/entry.md')).toEqual({
      kind: 'entry',
      path: '/home/reader/notes/sibling.md',
    })
  })

  it('holds when the served root is the filesystem root', () => {
    expect(resolve('LICENSE', 'README.md', '/')).toEqual({ kind: 'entry', path: 'LICENSE' })
  })
})

describe('URL syntax is stripped before the path is read', () => {
  it('drops a fragment and a query', () => {
    expect(resolve('docs/Requirements.md#status')).toEqual({
      kind: 'entry',
      path: 'docs/Requirements.md',
    })
    expect(resolve('docs/Requirements.md?raw=1')).toEqual({
      kind: 'entry',
      path: 'docs/Requirements.md',
    })
    expect(resolve('docs/Requirements.md?raw=1#status')).toEqual({
      kind: 'entry',
      path: 'docs/Requirements.md',
    })
  })

  it('decodes percent-escapes into the name on disk', () => {
    expect(resolve('docs/my%20notes.md')).toEqual({ kind: 'entry', path: 'docs/my notes.md' })
  })

  it('refuses an href whose escapes cannot be decoded', () => {
    expect(resolve('docs/%zz.md')).toEqual({ kind: 'inert' })
  })
})

// The href comes from file content: a document author can write anything. None
// of these may become a path the explorer opens, and the two that already have
// browser behaviour keep it.
describe('untrusted hrefs', () => {
  it('leaves http(s) links to the web, as before', () => {
    expect(resolve('https://example.com/x')).toEqual({ kind: 'external' })
    expect(resolve('HTTP://example.com/x')).toEqual({ kind: 'external' })
  })

  it('leaves an in-document anchor alone', () => {
    expect(resolve('#done-when')).toEqual({ kind: 'anchor' })
  })

  it('never reads a scheme, a protocol-relative URL or an empty href as a path', () => {
    const hostileHrefs = [
      '',
      '   ',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:someone@example.com',
      'ftp://example.com/x',
      '//evil.example/payload',
      '//evil.example/../../etc/passwd',
    ]
    for (const hostileHref of hostileHrefs) {
      expect({ href: hostileHref, ...resolve(hostileHref) }).toEqual({
        href: hostileHref,
        kind: 'inert',
      })
    }
    expect(resolve(undefined)).toEqual({ kind: 'inert' })
  })

  it('resolves nothing before the served root is known', () => {
    expect(resolve('LICENSE', 'README.md', null)).toEqual({ kind: 'inert' })
  })

  // A traversal is not refused here — it is expressed in the wire format the
  // existing confinement rule already governs, so a confined server refuses the
  // request with a 403 and this adds no path policy of its own. What must hold
  // is that it never silently reads as an in-root path.
  it('expresses a traversal out of the root as the absolute path it is', () => {
    expect(resolve('../../../../etc/passwd')).toEqual({ kind: 'entry', path: '/etc/passwd' })
    expect(resolve('%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd')).toEqual({
      kind: 'entry',
      path: '/etc/passwd',
    })
    expect(resolve('/../../etc/passwd')).toEqual({ kind: 'entry', path: '/etc/passwd' })
  })

  it('stops climbing at the filesystem root', () => {
    expect(resolve('../../../../../../../../../../etc/passwd')).toEqual({
      kind: 'entry',
      path: '/etc/passwd',
    })
  })

  it('never returns an in-root path for a traversal, whatever it is written as', () => {
    const traversalHrefs = [
      '../../../../etc/passwd',
      './../.././../../etc/passwd',
      '%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      'docs/../../../../etc/passwd',
    ]
    for (const traversalHref of traversalHrefs) {
      const target = resolve(traversalHref)
      expect(target.kind === 'entry' && target.path.startsWith('/')).toBe(true)
    }
  })
})
