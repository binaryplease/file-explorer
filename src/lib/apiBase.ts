import { createContext, useContext } from 'react'

// Where the file-explorer HTTP API lives, relative to the page the client runs
// on. Empty string = same-origin: the standalone app (dev-proxied by Vite,
// prod-served by our own Elysia) reaches `/api/fs/*` on its own origin, exactly
// as before. An embedding host — which mounts this surface into *its* page but
// runs our server as a separate process on another port — provides an absolute
// origin (e.g. `http://127.0.0.1:4600`) so every `fetch` and every raw-asset
// `<img src>` resolves against the explorer server, not the host page. This is
// the one seam that makes the surface portable; nothing else in the client
// hardcodes an origin.
export const ApiBaseContext = createContext<string>('')

export function useApiBase(): string {
  return useContext(ApiBaseContext)
}

// Prefix a server path-and-query with the configured base. A same-origin base
// ('') passes the path through untouched, so standalone requests stay relative.
export function withApiBase(baseUrl: string, pathAndQuery: string): string {
  return baseUrl === '' ? pathAndQuery : `${baseUrl}${pathAndQuery}`
}
