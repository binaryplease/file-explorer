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
