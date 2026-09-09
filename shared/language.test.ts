import { describe, expect, test } from 'bun:test'
import { languageForPath } from './language'

describe('languageForPath', () => {
  test('maps a known extension to its Shiki grammar', () => {
    expect(languageForPath('src/App.tsx')).toBe('tsx')
    expect(languageForPath('server/index.ts')).toBe('typescript')
    expect(languageForPath('style.css')).toBe('css')
    expect(languageForPath('data.json')).toBe('json')
  })

  test('retargets git-diff-view names to standalone Shiki IDs', () => {
    // `@git-diff-view/shiki` names these `c++` / `c#`; standalone Shiki uses
    // `cpp` / `csharp`, which is the whole point of the retarget.
    expect(languageForPath('engine.cpp')).toBe('cpp')
    expect(languageForPath('Program.cs')).toBe('csharp')
  })

  test('matches extensionless well-known filenames case-insensitively', () => {
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('deploy/Makefile')).toBe('makefile')
    expect(languageForPath('.bashrc')).toBe('bash')
    expect(languageForPath('CMakeLists.txt')).toBe('cmake')
  })

  test('defaults to txt for unknown or extensionless paths', () => {
    expect(languageForPath('notes.txt')).toBe('txt')
    expect(languageForPath('README')).toBe('txt')
    // A leading-dot dotfile with no further extension has nothing to key on.
    expect(languageForPath('.gitignore')).toBe('txt')
    expect(languageForPath('mystery.zzz')).toBe('txt')
    expect(languageForPath('')).toBe('txt')
  })
})
