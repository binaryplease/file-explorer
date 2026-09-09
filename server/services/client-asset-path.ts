// Mapping a production request path onto a file inside dist/client.
//
// Two things can go wrong before the file system is ever touched:
//
//   1. The pathname is not valid percent-encoding — `/%` , `/%zz`, `/%e0%a4` —
//      and `decodeURIComponent` throws `URIError`. Left unguarded in the route
//      handler that surfaced as an unhandled 500 for a request an attacker can
//      send at will. It is not an asset request; it is the SPA fallback case.
//   2. The decoded path escapes the client directory (`/../../etc/passwd`, or
//      the same thing percent-encoded, which is why containment is checked
//      *after* decoding). Also the fallback case — never a file read.
//
// Both collapse to the same answer: no asset. The caller serves index.html.

import { resolve } from 'node:path'

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    // URIError only — a malformed escape sequence. Nothing else in
    // decodeURIComponent throws.
    return null
  }
}

// Pure (`composable-design`): path arithmetic only, no `stat`, so the
// containment rule is testable without a dist/ tree. `null` means "not an asset
// request" — serve the SPA shell.
export function resolveClientAssetPath(options: {
  requestUrl: string
  clientDirectory: string
}): string | null {
  const { requestUrl, clientDirectory } = options

  const requestedPathname = decodePathname(new URL(requestUrl).pathname)
  if (requestedPathname === null) return null

  const candidatePath = resolve(clientDirectory, `.${requestedPathname}`)
  const isInsideClientDirectory =
    candidatePath === clientDirectory || candidatePath.startsWith(`${clientDirectory}/`)

  return isInsideClientDirectory ? candidatePath : null
}
