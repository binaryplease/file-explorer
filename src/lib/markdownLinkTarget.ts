import { absoluteTreePath, canonicalizeFocusPath, parentTreePath } from './tree'

// Where a link in a rendered markdown document points. The href is *file
// content* — untrusted input a document author chose — so every classification
// below is made from the href's own syntax, and only the last kind is ever
// handed to the explorer as a path.
//
// This module owns the whole decision (`composable-design`): it is pure string
// work over the tree's path vocabulary, so it lives beside the path helpers it
// composes (`code-lives-with-dependencies`) rather than inside the renderer, and
// its callers only branch on the kind.
export type MarkdownLinkTarget =
  // An `http(s)` URL: the web, opened in a new tab as it always has been.
  | { kind: 'external' }
  // A `#fragment` into the document itself. Left exactly as the browser handles
  // it today — in-document anchors are out of this requirement's scope.
  | { kind: 'anchor' }
  // Anything this explorer cannot address: an empty href (react-markdown's url
  // transform blanks a `javascript:`-style protocol before we ever see it), a
  // URL carrying any other scheme, a protocol-relative `//host` URL, an
  // undecodable escape, or a link rendered before the served root is known.
  // Rendered as the plain anchor it has always been, never turned into a path.
  | { kind: 'inert' }
  // A path inside the explorer, in the tree's own address vocabulary:
  // root-relative for an in-root entry ('' being the served root itself), or
  // absolute for a target the `../` chain walked out of the root — the same wire
  // format a tree row above the anchor already carries, so the existing
  // confinement rule decides it (a confined server refuses it with a 403) and
  // this adds no path policy of its own.
  | { kind: 'entry'; path: string }

const HTTP_URL_PATTERN = /^https?:\/\//i

// RFC 3986's scheme production: a letter, then letters, digits, `+`, `-`, `.`,
// then a colon. An href that matches carries a scheme and is a URL — `mailto:`,
// `file:`, `data:`, a `javascript:` that somehow survived — and must never be
// read as a filesystem path, whatever it looks like after the colon.
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

// Percent-escapes are URL syntax, so they are decoded *before* the `..`/`.`
// resolution below rather than after: `%2e%2e%2f` is a traversal written in
// escapes, and decoding it first means the normalizer resolves it like any
// other `../`, instead of a literal `%2e%2e` segment reaching the server as a
// filename. A malformed escape is not a path at all.
function decodePathReference(pathReference: string): string | null {
  try {
    return decodeURIComponent(pathReference)
  } catch {
    return null
  }
}

// POSIX normalization of an absolute path: empty and `.` segments drop out,
// `..` pops the segment before it, and popping past the filesystem root stops
// there (`/..` is `/`, as every kernel resolves it).
function normalizeAbsolutePath(path: string): string {
  const resolvedSegments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(segment)
  }
  return `/${resolvedSegments.join('/')}`
}

export type MarkdownLinkTargetOptions = {
  // The href exactly as the renderer resolved it, after its url transform.
  href: string | undefined
  // Tree path of the markdown document being rendered — the directory a
  // relative link is resolved against is this file's own.
  documentPath: string
  // The served root, needed to express any address at all. Null until the first
  // listing lands, which is the one moment nothing can be resolved.
  rootPath: string | null
}

export function resolveMarkdownLinkTarget({
  href,
  documentPath,
  rootPath,
}: MarkdownLinkTargetOptions): MarkdownLinkTarget {
  if (href === undefined) return { kind: 'inert' }
  const trimmedHref = href.trim()
  if (trimmedHref === '') return { kind: 'inert' }
  if (trimmedHref.startsWith('#')) return { kind: 'anchor' }
  if (HTTP_URL_PATTERN.test(trimmedHref)) return { kind: 'external' }
  // `//host/path` inherits the page's scheme — a URL to another origin that
  // reads like a path with a doubled slash. Checked before anything treats a
  // leading slash as a path.
  if (trimmedHref.startsWith('//')) return { kind: 'inert' }
  if (URL_SCHEME_PATTERN.test(trimmedHref)) return { kind: 'inert' }
  if (rootPath === null) return { kind: 'inert' }

  // A query and a fragment are URL syntax, not part of the name on disk:
  // `docs/Requirements.md#status` names the file, and the fragment is dropped
  // because it addresses a place *within* a rendered document we are not
  // rendering yet.
  const pathReference = trimmedHref.split('#')[0]!.split('?')[0]!
  if (pathReference === '') return { kind: 'inert' }
  const decodedReference = decodePathReference(pathReference)
  if (decodedReference === null) return { kind: 'inert' }

  // A leading slash is a site-root reference (`/docs/x.md` in a repo README),
  // which here means the *served root* — the app's own document root. Reading it
  // as a filesystem-absolute path instead would send every such link straight
  // out of the tree, which is neither what the author wrote nor the safer
  // reading. Everything else is relative to the document's own directory.
  const baseDirectory = decodedReference.startsWith('/')
    ? rootPath
    : absoluteTreePath(parentTreePath(documentPath), rootPath)
  const absoluteTarget = normalizeAbsolutePath(`${baseDirectory}/${decodedReference}`)
  // Speak the tree's address for it: in-root targets collapse back to the
  // root-relative form the listings are keyed by, and a target the `../` chain
  // walked outside the root stays absolute (`share-the-invariant` — the same
  // two helpers the breadcrumb and "copy path" resolve with).
  return { kind: 'entry', path: canonicalizeFocusPath(absoluteTarget, rootPath) }
}
