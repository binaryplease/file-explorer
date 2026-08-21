/**
 * Measures `GET /api/fs/list` against the stress fixture, and reports the
 * result against the budget in `docs/requirements/101-performance-budgets.md`
 * ("< ~50ms for a few-thousand-entry directory").
 *
 * It measures the **route**, not just the service, because the budget names the
 * endpoint. Three numbers come out of that, and they are the three things that
 * can make a listing slow — reported separately so a miss names its own cause
 * rather than leaving the next reader to re-instrument:
 *
 *   - **service** — the filesystem work: `readdir`, the `.gitignore` chain,
 *     and the per-entry stats / child readdirs / realpaths, each timed and
 *     counted by the service itself.
 *   - **route** — what the endpoint adds on top: response validation against
 *     the Zod schema, and serialization to JSON.
 *   - **payload** — the bytes the client then has to receive and parse.
 *
 * The app is assembled from the same route factory `server/index.ts` uses and
 * driven through `app.handle()`, so the whole request path is exercised (schema
 * validation included) without binding a port — the strict-bind rule stays out
 * of a benchmark's way, and `bench:listing` is safe to run beside a live dev
 * server.
 *
 * Usage:
 *   bun scripts/stress-fixture.ts            # once — build the fixture
 *   bun scripts/bench-listing.ts [--root DIR] [--path REL] [--runs N] [--confine]
 */
import { Elysia } from 'elysia'
import { createFilesystemService } from '../server/services/filesystem'
import { createFilesystemRoutes } from '../server/routes/filesystem'
import { defaultFixtureRoot, WIDE_MIXED_CASE } from './stress-fixture'

/** The endpoint budget this benchmark reports against. */
const LIST_BUDGET_MILLISECONDS = 50
const DEFAULT_RUN_COUNT = 7

type BenchmarkArguments = {
  rootAbsolutePath: string
  relativePath: string
  runCount: number
  confine: boolean
}

function parseBenchmarkArguments(commandLineArguments: string[]): BenchmarkArguments {
  const parsed: BenchmarkArguments = {
    rootAbsolutePath: defaultFixtureRoot(),
    relativePath: WIDE_MIXED_CASE,
    runCount: DEFAULT_RUN_COUNT,
    confine: false,
  }
  for (let index = 0; index < commandLineArguments.length; index++) {
    const flag = commandLineArguments[index]!
    const readValue = (): string => {
      const value = commandLineArguments[index + 1]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      index++
      return value
    }
    switch (flag) {
      case '--root':
        parsed.rootAbsolutePath = readValue()
        break
      case '--path':
        parsed.relativePath = readValue()
        break
      case '--runs': {
        const value = readValue()
        parsed.runCount = Number(value)
        if (!Number.isInteger(parsed.runCount) || parsed.runCount < 1) {
          throw new Error(`--runs needs a positive integer, got ${value}`)
        }
        break
      }
      case '--confine':
        parsed.confine = true
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return parsed
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function milliseconds(value: number): string {
  return `${value.toFixed(1)}ms`
}

/**
 * Reads back the counts the service reported through its `Server-Timing`
 * header — the same values a browser shows in devtools, parsed here so the
 * benchmark reports syscalls beside wall clock without a second code path.
 */
function parseServerTiming(headerValue: string | null): Record<string, string> {
  const parsed: Record<string, string> = {}
  if (headerValue === null) return parsed
  for (const metric of headerValue.split(',')) {
    const [name, ...parameters] = metric.trim().split(';')
    if (name === undefined) continue
    for (const parameter of parameters) {
      const [parameterName, parameterValue] = parameter.split('=')
      if (parameterName === 'dur') parsed[name] = parameterValue ?? ''
      if (parameterName === 'desc') parsed[name] = (parameterValue ?? '').replace(/"/g, '')
    }
  }
  return parsed
}

const benchmarkArguments = parseBenchmarkArguments(process.argv.slice(2))

const filesystemService = createFilesystemService({
  rootAbsolutePath: benchmarkArguments.rootAbsolutePath,
  confine: benchmarkArguments.confine,
})
const app = new Elysia().use(createFilesystemRoutes({ filesystemService }))
const requestUrl = `http://127.0.0.1/api/fs/list?path=${encodeURIComponent(benchmarkArguments.relativePath)}`

async function timeOneRequest(): Promise<{
  elapsedMilliseconds: number
  payloadBytes: number
  serverTiming: Record<string, string>
  status: number
}> {
  const startedAt = performance.now()
  const response = await app.handle(new Request(requestUrl))
  const body = await response.arrayBuffer()
  return {
    elapsedMilliseconds: performance.now() - startedAt,
    payloadBytes: body.byteLength,
    serverTiming: parseServerTiming(response.headers.get('Server-Timing')),
    status: response.status,
  }
}

// One untimed warm-up: the first request pays for JIT and for whatever of the
// tree is not yet in the page cache, and neither is what the budget is about.
const warmUp = await timeOneRequest()
if (warmUp.status !== 200) {
  console.error(
    `listing ${benchmarkArguments.relativePath} under ${benchmarkArguments.rootAbsolutePath} ` +
      `failed with ${warmUp.status} — has the fixture been generated? ` +
      `(bun scripts/stress-fixture.ts)`,
  )
  process.exit(1)
}

const endToEndSamples: number[] = []
const serviceSamples: number[] = []
let lastRun = warmUp

// Nothing but the request inside this loop. Anything else here — an extra
// listing, an extra encode — allocates alongside the run it is meant to
// measure, and the garbage it leaves is collected during the next one.
for (let run = 0; run < benchmarkArguments.runCount; run++) {
  lastRun = await timeOneRequest()
  endToEndSamples.push(lastRun.elapsedMilliseconds)
  serviceSamples.push(Number(lastRun.serverTiming.list ?? '0'))
}

// Serialization sampled afterwards, on its own, so the route's share can be
// split into "encoding JSON" and "everything else between the handler's return
// value and the bytes" — response validation and framework overhead.
const serializationSamples: number[] = []
for (let run = 0; run < benchmarkArguments.runCount; run++) {
  const listed = await filesystemService.listDirectory(benchmarkArguments.relativePath)
  if (!listed.ok) break
  const serializationStartedAt = performance.now()
  JSON.stringify(listed.listing)
  serializationSamples.push(performance.now() - serializationStartedAt)
}

const endToEndMedian = median(endToEndSamples)
const serviceMedian = median(serviceSamples)
const serializationMedian = median(serializationSamples)
const timing = lastRun.serverTiming

console.log(`GET /api/fs/list?path=${benchmarkArguments.relativePath}`)
console.log(`  root      ${benchmarkArguments.rootAbsolutePath}`)
console.log(
  `  mode      ${benchmarkArguments.confine ? 'confined' : 'unconfined'}, ` +
    `${benchmarkArguments.runCount} runs after one warm-up`,
)
console.log(
  `  entries   ${timing.entries ?? '?'} (${timing.dirs ?? '?'} directories), ` +
    `${(lastRun.payloadBytes / 1024 / 1024).toFixed(2)} MiB of JSON`,
)
console.log(
  `  syscalls  ${timing.stats ?? '?'} stats, ${timing.childreaddirs ?? '?'} child readdirs, ` +
    `${timing.realpaths ?? '?'} realpaths`,
)
console.log('')
console.log(`  end-to-end     ${milliseconds(endToEndMedian)} median, ` +
  `${milliseconds(Math.min(...endToEndSamples))} best`)
console.log(`    service      ${milliseconds(serviceMedian)}`)
console.log(
  `      readdir    ${milliseconds(Number(timing.readdir ?? '0'))}` +
    `   ignore ${milliseconds(Number(timing.ignore ?? '0'))}` +
    `   describe ${milliseconds(Number(timing.describe ?? '0'))}`,
)
console.log(`    route        ${milliseconds(endToEndMedian - serviceMedian)}`)
console.log(`      serialize  ${milliseconds(serializationMedian)} (JSON.stringify alone)`)
console.log(
  `      validate   ${milliseconds(endToEndMedian - serviceMedian - serializationMedian)} (remainder: response schema + framework)`,
)
console.log('')
const verdict = endToEndMedian <= LIST_BUDGET_MILLISECONDS ? 'MEETS' : 'MISSES'
console.log(
  `  ${verdict} the ${LIST_BUDGET_MILLISECONDS}ms GET /api/fs/list budget ` +
    `(${(endToEndMedian / LIST_BUDGET_MILLISECONDS).toFixed(1)}× budget)`,
)
