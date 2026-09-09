// Opens a filesystem path with the operating system's default application —
// the desktop "open" gesture, run on the machine hosting the explorer (a
// local-only, loopback tool, so that machine is the user's own). Each platform
// has its own launcher; the launched process is detached so it outlives the
// request that triggered it. This capability depends only on the platform and
// Bun's process spawner, so per `code-lives-with-dependencies` it lives in its
// own module rather than inside the filesystem service.

type OpenerInvocation = { command: string; commandArguments: string[] }

function defaultOpenerFor(targetAbsolutePath: string): OpenerInvocation {
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', commandArguments: [targetAbsolutePath] }
    case 'win32':
      // `start` is a cmd builtin; the empty "" is the window-title argument it
      // consumes before the path.
      return { command: 'cmd', commandArguments: ['/c', 'start', '', targetAbsolutePath] }
    default:
      return { command: 'xdg-open', commandArguments: [targetAbsolutePath] }
  }
}

// Hands the path to the platform launcher and returns immediately. Throws when
// the launcher can't be spawned (e.g. `xdg-open` is not on PATH); the caller
// translates that into a request failure.
export function openPathWithDefaultApplication(targetAbsolutePath: string): void {
  const { command, commandArguments } = defaultOpenerFor(targetAbsolutePath)
  const openerProcess = Bun.spawn([command, ...commandArguments], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  // Let the launcher run independently — we neither wait for nor block on it.
  openerProcess.unref()
}
