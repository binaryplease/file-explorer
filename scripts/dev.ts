/**
 * Dev entry point: resolve ports first, then hand off to `concurrently`.
 *
 * The port work lives in ./dev-ports.ts; this file is orchestration only
 * (ADR-0010). Process supervision stays with `concurrently -k` rather than
 * signal/PID ceremony here (ADR-0021).
 */
import { describeDevPorts, devPortEnvironment, resolveDevPorts } from './dev-ports'
import { devRootEnvironment, repositoryRoot } from './dev-root'

const devPorts = await resolveDevPorts()
console.log(describeDevPorts(devPorts))

const devProcess = Bun.spawn(
  [
    'bunx',
    'concurrently',
    '-k',
    '-n',
    'server,client',
    'bun --watch server/index.ts',
    'bunx vite',
  ],
  {
    // Resolve against this script's own location so the dev task works from any
    // cwd (ADR-0011).
    cwd: repositoryRoot,
    // The served root is a default (`bun dev` gets what `mise run dev` gets),
    // the ports are decisions already made above — hence the order: an
    // EXPLORER_ROOT from the environment survives, a stale PORT does not.
    env: { ...process.env, ...devRootEnvironment(), ...devPortEnvironment(devPorts) },
    stdio: ['inherit', 'inherit', 'inherit'],
  },
)

// Forward termination to `concurrently`, which owns killing both dev servers
// (`-k`). Without this the supervisor is orphaned on Ctrl-C and keeps the ports
// bound — exactly the zombie ADR-0018 exists to make visible.
for (const terminationSignal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(terminationSignal, () => devProcess.kill(terminationSignal))
}

process.exit(await devProcess.exited)
