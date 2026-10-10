#!/usr/bin/env node

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const [tarballArgument = '.worldkit-release/tarballs', consumerArgument = '.worldkit-release/consumer'] = process.argv.slice(2)
const repositoryRoot = resolve(import.meta.dirname, '../..')
const tarballRoot = resolve(repositoryRoot, tarballArgument)
const consumerRoot = resolve(repositoryRoot, consumerArgument)
const tarballs = (await readdir(tarballRoot))
  .filter((name) => name.endsWith('.tgz'))
  .sort()
  .map((name) => resolve(tarballRoot, name))
if (tarballs.length !== 4) throw new Error(`Expected four WorldKit tarballs, found ${tarballs.length}`)

await rm(consumerRoot, { recursive: true, force: true })
await mkdir(consumerRoot, { recursive: true })
await Promise.all([
  writeFile(resolve(consumerRoot, 'package.json'), `${JSON.stringify({ name: 'worldkit-clean-consumer', private: true, type: 'module' }, null, 2)}\n`),
  writeFile(resolve(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['consumer.ts'],
  }, null, 2)}\n`),
  writeFile(resolve(consumerRoot, 'consumer.ts'), `import { WorldClient, type ListEntitiesOptions } from '@worlddevkit/client'\nimport { createMemoryRateLimiter, createWorldHandler, type EntitySource } from '@worlddevkit/server'\nimport { WORLD_PROTOCOL_VERSION, type EntityEnvelope, type WorldDiscoveryDocument } from '@worlddevkit/spec'\nimport { assertLevel1Conformance, type Level1ConformanceReport } from '@worlddevkit/testing'\n\nconst options: ListEntitiesOptions = { limit: 1 }\nconst entities: EntityEnvelope[] = []\nconst source: EntitySource = { async list() { return entities }, async get() { return null } }\nconst world: WorldDiscoveryDocument = { protocol: WORLD_PROTOCOL_VERSION, id: 'https://consumer.invalid', name: 'Consumer', endpoints: { api: 'https://consumer.invalid/api/world/v0' }, entityTypes: ['wp:store'], actions: ['wp:discover'] }\nconst handler = createWorldHandler({ world, source, rateLimiter: createMemoryRateLimiter({ limit: 10, windowMs: 1_000 }) })\nconst client = new WorldClient(world)\nconst check: Promise<Level1ConformanceReport> = assertLevel1Conformance({ world: world.id })\nvoid options\nvoid handler\nvoid client\nvoid check\n`),
  writeFile(resolve(consumerRoot, 'smoke.mjs'), `import { WorldClient, WorldHttpError } from '@worlddevkit/client'\nimport { createMemoryRateLimiter, createWorldHandler } from '@worlddevkit/server'\nimport { WORLD_PROTOCOL_VERSION } from '@worlddevkit/spec'\nimport { assertLevel1Conformance } from '@worlddevkit/testing'\n\nconst world = { protocol: WORLD_PROTOCOL_VERSION, id: 'https://fixture.world', name: 'Packed fixture', endpoints: { api: 'https://fixture.world/api/world/v0' }, entityTypes: ['wp:store'], actions: ['wp:discover'] }\nconst entities = [{ ref: { world: world.id, type: 'wp:store', id: 'one' }, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', visibility: 'public', attributes: { name: 'One' }, relationships: [], capabilities: [] }, { ref: { world: world.id, type: 'wp:store', id: 'two' }, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', visibility: 'public', attributes: { name: 'Two' }, relationships: [], capabilities: [] }]\nconst source = { async list(type) { return type === 'wp:store' ? entities : [] }, async get(type, id) { return entities.find((entity) => entity.ref.type === type && entity.ref.id === id) ?? null } }\nconst handler = createWorldHandler({ world, source, rateLimiter: createMemoryRateLimiter({ limit: 100, windowMs: 60_000 }), cors: '*' })\nconst fixtureFetch = async (input, init) => { const request = new Request(input, init); if (new URL(request.url).pathname === '/.well-known/world.json') return new Response(JSON.stringify(world), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } }); return handler(request) }\nconst client = await WorldClient.connect(world.id, { fetch: fixtureFetch })\nconst first = await client.listEntities('wp:store', { limit: 1 })\nif (first.entities.length !== 1 || first.nextCursor === null) throw new Error('Packed client pagination failed')\nif ((await client.getEntity('wp:store', 'one')).ref.id !== 'one') throw new Error('Packed client get failed')\nif ((await client.discover({ text: 'Two' })).entities[0]?.ref.id !== 'two') throw new Error('Packed client discover failed')\nlet pages = 0\nfor await (const page of client.paginateEntities('wp:store', { limit: 1 })) pages += page.entities.length\nif (pages !== 2) throw new Error('Packed client iterator failed')\ntry { await client.getEntity('wp:store', 'missing'); throw new Error('Expected WorldHttpError') } catch (error) { if (!(error instanceof WorldHttpError) || error.code !== 'entity_not_found') throw error }\nconst report = await assertLevel1Conformance({ world: world.id, fetch: fixtureFetch }, { pageSize: 1 })\nif (!report.passed || report.checks.length !== 8) throw new Error('Packed conformance failed')\nconsole.log('Clean WorldKit consumer passed runtime and Level 1 conformance smoke tests')\n`),
])

await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@5.9.3', ...tarballs], consumerRoot)
await run('node', ['smoke.mjs'], consumerRoot)
await run(resolve(consumerRoot, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], consumerRoot)
console.log('Clean WorldKit consumer passed TypeScript declaration compilation')

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with status ${String(code)}`)))
  })
}
