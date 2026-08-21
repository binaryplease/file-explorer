import { describe, expect, test } from 'bun:test'
import {
  createListingCounters,
  formatListingTimingLine,
  toServerTimingHeader,
  type ListingTiming,
} from './listing-timing'

const sampleTiming: ListingTiming = {
  totalMilliseconds: 92.84,
  readdirMilliseconds: 9.31,
  ignoreMilliseconds: 0.16,
  describeMilliseconds: 83.37,
  entryCount: 40_000,
  directoryCount: 37_200,
  statCount: 2_802,
  childReaddirCount: 37_200,
  realpathCount: 0,
}

describe('listing timing counters', () => {
  test('start at zero, so a listing that issues no syscall reports none', () => {
    expect(createListingCounters()).toEqual({
      statCount: 0,
      childReaddirCount: 0,
      realpathCount: 0,
    })
  })

  test('each counter is its own field, never shared between listings', () => {
    const first = createListingCounters()
    const second = createListingCounters()
    first.statCount++
    expect(second.statCount).toBe(0)
  })
})

describe('Server-Timing rendering', () => {
  const header = toServerTimingHeader(sampleTiming)

  test('renders the phases as durations', () => {
    expect(header).toContain('list;dur=92.8')
    expect(header).toContain('readdir;dur=9.3')
    expect(header).toContain('ignore;dur=0.2')
    expect(header).toContain('describe;dur=83.4')
  })

  // Counts are not durations, so they ride as `desc` on a metric with no `dur`
  // — the form the header grammar allows and browsers display.
  test('renders the syscall counts as descriptions', () => {
    expect(header).toContain('entries;desc="40000"')
    expect(header).toContain('dirs;desc="37200"')
    expect(header).toContain('stats;desc="2802"')
    expect(header).toContain('childreaddirs;desc="37200"')
    expect(header).toContain('realpaths;desc="0"')
  })

  test('is a single comma-separated header value', () => {
    expect(header.split(', ')).toHaveLength(9)
    expect(header).not.toContain('\n')
  })

  // `emit-nullish` in header form: a zero count is written out, never dropped,
  // so "no realpaths were issued" is legible as such rather than as a gap.
  test('emits a zero count rather than omitting the metric', () => {
    expect(toServerTimingHeader({ ...sampleTiming, statCount: 0 })).toContain('stats;desc="0"')
  })
})

describe('timing log line', () => {
  test('names the listed path, the phases and the syscall counts', () => {
    const line = formatListingTimingLine('projects/deep', sampleTiming)
    expect(line).toStartWith('list projects/deep 92.8ms')
    expect(line).toContain('readdir 9.3ms')
    expect(line).toContain('describe 83.4ms')
    expect(line).toContain('40000 entries')
    expect(line).toContain('2802 stats')
    expect(line).toContain('37200 child readdirs')
  })

  // The served root's own relative path is the empty string, which would read
  // as a missing field in a log line.
  test('writes the served root as `.` rather than as nothing', () => {
    expect(formatListingTimingLine('', sampleTiming)).toStartWith('list . ')
  })
})

// A path is filesystem data. On Linux a directory name may legally contain a
// newline, and this line is written one-per-listing to stdout — so an unescaped
// name forges a second line that reads exactly like one the server wrote.
describe('log line treats the path as data, not as formatting', () => {
  const NEWLINE = String.fromCharCode(10)
  const CARRIAGE_RETURN = String.fromCharCode(13)
  const TAB = String.fromCharCode(9)
  const DELETE_CHARACTER = String.fromCharCode(127)

  test('escapes a newline in a directory name instead of ending the line', () => {
    const forgedLine = `evil${NEWLINE}list /etc 0.1ms (readdir 0.0ms,`
    const line = formatListingTimingLine(forgedLine, sampleTiming)
    expect(line).not.toContain(NEWLINE)
    expect(line).toContain('evil\\x0a')
    // Still exactly one line, so a log reader still counts one listing.
    expect(line.split(NEWLINE)).toHaveLength(1)
  })

  test('escapes carriage return, tab and DEL the same way', () => {
    const line = formatListingTimingLine(
      `a${CARRIAGE_RETURN}b${TAB}c${DELETE_CHARACTER}d`,
      sampleTiming,
    )
    expect(line).toContain('a\\x0db\\x09c\\x7fd')
  })

  test('leaves ordinary and non-ASCII path characters alone', () => {
    const line = formatListingTimingLine('projects/rapport-café/ünicode dir', sampleTiming)
    expect(line).toContain('projects/rapport-café/ünicode dir')
    expect(line).not.toContain('\\x')
  })

  // The header carries no path at all, so it has nothing to inject into —
  // asserted so that stays true if a path is ever added to it.
  test('the Server-Timing header carries no path to inject into', () => {
    const header = toServerTimingHeader(sampleTiming)
    expect(header).not.toContain(NEWLINE)
    expect(header).not.toContain(CARRIAGE_RETURN)
    // Printable ASCII only: nothing in it comes from the filesystem.
    expect(/^[ -~]+$/.test(header)).toBe(true)
  })
})
