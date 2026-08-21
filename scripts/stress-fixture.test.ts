import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  DEFAULT_ENTRY_COUNT,
  FEW_THOUSAND_ENTRY_COUNT,
  defaultFixtureRoot,
  mixedCaseShape,
  parseStressFixtureArguments,
  stressFixturePlan,
} from './stress-fixture'

describe('mixed-case shape', () => {
  test('splits an entry count into directories, files and the two symlinks', () => {
    const shape = mixedCaseShape(1_000)
    expect(shape.entryCount).toBe(1_000)
    expect(shape.symlinkCount).toBe(2)
    expect(shape.directoryCount + shape.fileCount + shape.symlinkCount).toBe(1_000)
  })

  // The miss was measured on a directory that was 93% directories, and
  // directories are the expensive kind — a fixture with an even split would
  // understate the cost it exists to reproduce.
  test('is directory-heavy, matching the shape the miss was measured on', () => {
    const shape = mixedCaseShape(DEFAULT_ENTRY_COUNT)
    expect(shape.directoryCount / shape.entryCount).toBeGreaterThan(0.9)
  })

  test('every scale accounts for exactly its entry count', () => {
    for (const entryCount of [3, 10, 4_000, 40_000]) {
      const shape = mixedCaseShape(entryCount)
      expect(shape.directoryCount + shape.fileCount + shape.symlinkCount).toBe(entryCount)
    }
  })
})

describe('fixture plan', () => {
  test('defaults past the entry count the miss was measured on', () => {
    const plan = stressFixturePlan()
    expect(plan.entryCount).toBeGreaterThan(37_071)
    expect(plan.wideMixed.entryCount).toBe(DEFAULT_ENTRY_COUNT)
  })

  // The budget is written for "a few-thousand-entry directory"; the 40 000-entry
  // case is the 10× stretch. Both must be measurable, so both are built.
  test('always carries the scale the budget is written for', () => {
    expect(stressFixturePlan().fewThousand.entryCount).toBe(FEW_THOUSAND_ENTRY_COUNT)
  })

  test('never builds a small case larger than the large one', () => {
    const plan = stressFixturePlan({ entryCount: 500 })
    expect(plan.fewThousand.entryCount).toBe(500)
  })

  test('defaults to a root outside the repository, so nothing can be committed', () => {
    expect(defaultFixtureRoot()).toStartWith(tmpdir())
    expect(stressFixturePlan().rootAbsolutePath).toStartWith(tmpdir())
  })

  test('resolves a relative root to an absolute path', () => {
    expect(isAbsolute(stressFixturePlan({ rootAbsolutePath: 'scratch' }).rootAbsolutePath)).toBe(
      true,
    )
  })

  // The escaping symlink is what keeps the confinement path exercised at scale,
  // so it must land outside the served root on any machine.
  test('points the escaping symlink outside the fixture root', () => {
    const plan = stressFixturePlan({ rootAbsolutePath: join(tmpdir(), 'bfe-fixture-under-test') })
    expect(plan.escapingLinkTarget.startsWith(`${plan.rootAbsolutePath}/`)).toBe(false)
  })

  test.each([
    ['--entries', { entryCount: 2 }],
    ['--entries', { entryCount: 1.5 }],
    ['--children', { childrenPerDirectory: -1 }],
    ['--depth', { depth: 0 }],
  ])('rejects an unusable %s value rather than building a useless tree', (_flag, badArguments) => {
    expect(() => stressFixturePlan(badArguments)).toThrow()
  })
})

describe('argument parsing', () => {
  test('reads every flag the generator accepts', () => {
    expect(
      parseStressFixtureArguments([
        '--root',
        '/tmp/somewhere',
        '--entries',
        '500',
        '--children',
        '3',
        '--depth',
        '8',
        '--force',
        '--remove',
      ]),
    ).toEqual({
      rootAbsolutePath: '/tmp/somewhere',
      entryCount: 500,
      childrenPerDirectory: 3,
      depth: 8,
      force: true,
      remove: true,
    })
  })

  test('is empty for no arguments, leaving every default to the plan', () => {
    expect(parseStressFixtureArguments([])).toEqual({})
  })

  // Fail loud at the boundary: a mistyped flag must not be silently ignored,
  // which would leave a benchmark measuring a tree nobody asked for.
  test('refuses an unknown flag', () => {
    expect(() => parseStressFixtureArguments(['--entrys', '10'])).toThrow('unknown flag: --entrys')
  })

  test('refuses a flag with no value', () => {
    expect(() => parseStressFixtureArguments(['--entries'])).toThrow('--entries needs a value')
  })

  test('refuses a non-integer count', () => {
    expect(() => parseStressFixtureArguments(['--entries', 'lots'])).toThrow('needs an integer')
  })
})
