import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { defineEntityProjection, isExportable, project, type ProjectionContext } from './entity'

interface StoreRow {
  id: string
  name: string
  published: boolean
  secretNote: string
}

const storeProjection = defineEntityProjection<StoreRow, { name: string }>({
  type: 'wp:store',
  id: (row) => row.id,
  version: () => 3,
  updatedAt: () => new Date('2026-10-07T10:00:00Z'),
  visibility: (row) => (row.published ? 'public' : 'private'),
  attributes: (row) => ({ name: row.name }),
  capabilities: (_row, ctx) => (ctx.caller.kind === 'anonymous' ? ['wp:view'] : ['wp:view', 'wp:follow']),
  sponsorship: () => undefined,
})

const anonymous: ProjectionContext = { world: 'https://world.kobotai.co', caller: { kind: 'anonymous', scopes: [] } }

describe('project', () => {
  it('builds the envelope from the projection only', () => {
    const entity = project(storeProjection, { id: 's1', name: 'XYZ Fashion', published: true, secretNote: 'x' }, anonymous)
    expect(entity).toEqual({
      ref: { world: 'https://world.kobotai.co', type: 'wp:store', id: 's1' },
      version: 3,
      updatedAt: '2026-10-07T10:00:00.000Z',
      visibility: 'public',
      attributes: { name: 'XYZ Fashion' },
      relationships: [],
      capabilities: ['wp:view'],
    })
    expect(JSON.stringify(entity)).not.toContain('secretNote')
  })

  it('hides private entities from callers without a private grant', () => {
    const row = { id: 's2', name: 'Hidden', published: false, secretNote: '' }
    expect(project(storeProjection, row, anonymous)).toBeNull()
    expect(
      project(storeProjection, row, { ...anonymous, caller: { kind: 'person', scopes: ['read:private:store'] } })
    ).not.toBeNull()
  })
})

describe('isExportable', () => {
  const layers = [
    { id: 'faith', sensitivity: 'sensitive' as const },
    { id: 'nightlife', sensitivity: 'normal' as const },
  ]

  it('blocks sensitive-layer entities from exports', () => {
    expect(isExportable({ layer: 'faith' }, layers)).toBe(false)
    expect(isExportable({ layer: 'nightlife' }, layers)).toBe(true)
    expect(isExportable({}, layers)).toBe(true)
  })
})

describe('package boundaries', () => {
  // packages/worldkit-* must stay free of KobotAI, Prisma and Next.js so they can be open-sourced.
  const FORBIDDEN = [/from ['"]@prisma\//, /from ['"]next[/'"]/, /from ['"]@\//, /kobotai/i, /from ['"]\.\.\/\.\.\/(apps|src)\//]
  const packagesDir = fileURLToPath(new URL('../../', import.meta.url))

  it('has no KobotAI-specific imports or references', () => {
    const offenders: string[] = []
    for (const pkg of readdirSync(packagesDir).filter((name) => name.startsWith('worldkit-'))) {
      const srcDir = join(packagesDir, pkg, 'src')
      for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
        const source = readFileSync(join(srcDir, file), 'utf8')
        for (const pattern of FORBIDDEN) {
          if (pattern.test(source)) offenders.push(`${pkg}/src/${file} matches ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
