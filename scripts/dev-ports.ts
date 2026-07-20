/**
 * Pre-dev port setup.
 *
 * ADR-0018 keeps port conflicts fatal *at bind time*: neither Elysia nor Vite
 * may migrate to another port behind the developer's back. This module runs
 * strictly *before* either process starts — it probes the canonical ports,
 * announces every conflict it finds, and picks explicit replacements that are
 * then pinned into both processes' environment. Nothing is silent, the two
 * ports stay coherent (Vite's `/api` proxy is retargeted with the server), and
 * the runtime bind remains strict: if the chosen port is stolen between the
 * probe and the bind, the server still dies loudly.
 */
import { createServer } from 'node:net'

export const CANONICAL_SERVER_PORT = 3000
export const CANONICAL_CLIENT_PORT = 5173

/** How far above the canonical port we are willing to search before giving up. */
const PORT_SEARCH_SPAN = 50

export type DevPortAssignment = {
  /** The port the service is configured to want. */
  requestedPort: number
  /** The port it will actually be started on. */
  assignedPort: number
  /** True when the canonical port was taken and a replacement was chosen. */
  wasReassigned: boolean
}

export type DevPorts = {
  host: string
  server: DevPortAssignment
  client: DevPortAssignment
}

/**
 * True when nothing is listening on `port` for `host`.
 *
 * Uses a real bind rather than a connect probe: a connect probe cannot tell an
 * unbound port from one bound by a process that refuses connections, and the
 * question we actually care about is "can our server bind here".
 */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probeServer = createServer()
    probeServer.once('error', () => resolvePromise(false))
    probeServer.once('listening', () => probeServer.close(() => resolvePromise(true)))
    // exclusive: true — never let SO_REUSEPORT-style sharing mask a conflict
    // (ADR-0018).
    probeServer.listen({ port, host, exclusive: true })
  })
}

/**
 * The first free port at or above `requestedPort`, skipping anything in
 * `reservedPorts` (ports already handed to a sibling process in this run, which
 * nothing is listening on yet).
 *
 * Throws when the whole search span is occupied — an environment that broken
 * should stop the developer, not be worked around.
 */
export async function findAvailablePort(
  requestedPort: number,
  host: string,
  reservedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (let candidatePort = requestedPort; candidatePort < requestedPort + PORT_SEARCH_SPAN; candidatePort++) {
    if (reservedPorts.has(candidatePort)) continue
    if (await isPortAvailable(candidatePort, host)) return candidatePort
  }
  throw new Error(
    `No free port found in ${requestedPort}-${requestedPort + PORT_SEARCH_SPAN - 1} on ${host}. ` +
      'Something is occupying the whole range — check for runaway dev servers.',
  )
}

async function assignPort(
  requestedPort: number,
  host: string,
  reservedPorts: Set<number>,
): Promise<DevPortAssignment> {
  const assignedPort = await findAvailablePort(requestedPort, host, reservedPorts)
  reservedPorts.add(assignedPort)
  return { requestedPort, assignedPort, wasReassigned: assignedPort !== requestedPort }
}

/**
 * Resolve the pair of ports the dev session will use. The server is assigned
 * first so the client's `/api` proxy target is known before Vite starts.
 */
export async function resolveDevPorts(): Promise<DevPorts> {
  const host = process.env.HOST || '127.0.0.1'
  const requestedServerPort = Number(process.env.PORT) || CANONICAL_SERVER_PORT
  const requestedClientPort = Number(process.env.VITE_PORT) || CANONICAL_CLIENT_PORT
  const reservedPorts = new Set<number>()

  return {
    host,
    server: await assignPort(requestedServerPort, host, reservedPorts),
    client: await assignPort(requestedClientPort, host, reservedPorts),
  }
}

/** Environment overrides that pin the resolved ports into both dev processes. */
export function devPortEnvironment(devPorts: DevPorts): Record<string, string> {
  return {
    HOST: devPorts.host,
    PORT: String(devPorts.server.assignedPort),
    VITE_PORT: String(devPorts.client.assignedPort),
    // vite.config.ts proxies /api here; it must follow a reassigned server.
    VITE_API_TARGET: `http://${devPorts.host}:${devPorts.server.assignedPort}`,
  }
}

function describeAssignment(label: string, assignment: DevPortAssignment): string {
  if (!assignment.wasReassigned) return `  ${label}: ${assignment.assignedPort}`
  return `  ${label}: ${assignment.assignedPort}  (port ${assignment.requestedPort} is in use — reassigned)`
}

/** Human-readable summary printed before the dev servers start. */
export function describeDevPorts(devPorts: DevPorts): string {
  const lines = [
    `Dev ports on ${devPorts.host}`,
    describeAssignment('server', devPorts.server),
    describeAssignment('client', devPorts.client),
  ]
  if (devPorts.server.wasReassigned || devPorts.client.wasReassigned) {
    lines.push(
      '  Note: a canonical port was taken. Another dev server is probably still',
      '  running — open http://' + `${devPorts.host}:${devPorts.client.assignedPort}` + ' for this session.',
    )
  }
  return lines.join('\n')
}

// `mise run dev:ports` / `bun scripts/dev-ports.ts` — probe and report only.
// `--env` prints KEY=value lines for shells that want to eval the result.
if (import.meta.main) {
  const devPorts = await resolveDevPorts()
  if (process.argv.includes('--env')) {
    for (const [name, value] of Object.entries(devPortEnvironment(devPorts))) {
      console.log(`${name}=${value}`)
    }
  } else {
    console.log(describeDevPorts(devPorts))
  }
}
