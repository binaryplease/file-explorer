import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { devRootEnvironment, repositoryRoot } from './dev-root'

describe('repositoryRoot', () => {
  test('points at this checkout, not the cwd', () => {
    expect(existsSync(join(repositoryRoot, 'package.json'))).toBe(true)
    expect(existsSync(join(repositoryRoot, 'server', 'index.ts'))).toBe(true)
  })

  test('carries no trailing separator', () => {
    expect(repositoryRoot.endsWith('/')).toBe(false)
  })
})

describe('devRootEnvironment', () => {
  test('serves the repo when the environment names no root', () => {
    expect(devRootEnvironment({})).toEqual({ EXPLORER_ROOT: repositoryRoot })
  })

  test('leaves a configured root alone', () => {
    expect(devRootEnvironment({ EXPLORER_ROOT: '/srv/photos' })).toEqual({})
  })

  test('treats a blank root as unset rather than serving nowhere', () => {
    expect(devRootEnvironment({ EXPLORER_ROOT: '   ' })).toEqual({
      EXPLORER_ROOT: repositoryRoot,
    })
  })
})
