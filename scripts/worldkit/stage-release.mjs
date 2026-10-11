#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const libraryPackageNames = ['core', 'geo', 'spec', 'server', 'client', 'testing']
const internalNames = new Set(libraryPackageNames.map((name) => `@worlddevkit/${name}`))
const [version, outputArgument = '.worldkit-release/staged'] = process.argv.slice(2)

if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/worldkit/stage-release.mjs <semver> [output-directory]')
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const outputRoot = resolve(repositoryRoot, outputArgument)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

for (const shortName of libraryPackageNames) {
  const sourceDirectory = resolve(repositoryRoot, `packages/worldkit-${shortName}`)
  const targetDirectory = resolve(outputRoot, shortName)
  const sourceManifest = JSON.parse(await readFile(resolve(sourceDirectory, 'package.json'), 'utf8'))
  const dependencies = rewriteDependencies(sourceManifest.dependencies ?? {}, version)
  const manifest = {
    name: sourceManifest.name,
    version,
    description: sourceManifest.description,
    license: sourceManifest.license,
    repository: sourceManifest.repository,
    homepage: sourceManifest.homepage,
    bugs: sourceManifest.bugs,
    type: sourceManifest.type,
    main: sourceManifest.main,
    types: sourceManifest.types,
    exports: sourceManifest.exports,
    files: ['dist', 'README.md', 'LICENSE'],
    sideEffects: sourceManifest.sideEffects,
    engines: sourceManifest.engines,
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    publishConfig: { access: 'public' },
  }

  assertLibraryPublishManifest(manifest)
  await mkdir(targetDirectory, { recursive: true })
  await Promise.all([
    cp(resolve(sourceDirectory, 'dist'), resolve(targetDirectory, 'dist'), { recursive: true }),
    cp(resolve(sourceDirectory, 'README.md'), resolve(targetDirectory, 'README.md')),
    cp(resolve(sourceDirectory, 'LICENSE'), resolve(targetDirectory, 'LICENSE')),
    writeFile(resolve(targetDirectory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  ])
}

const cliSourceDirectory = resolve(repositoryRoot, 'packages/create-worlddevkit')
const cliTargetDirectory = resolve(outputRoot, 'create-worlddevkit')
const cliSourceManifest = JSON.parse(await readFile(resolve(cliSourceDirectory, 'package.json'), 'utf8'))
const cliManifest = {
  name: cliSourceManifest.name,
  version,
  description: cliSourceManifest.description,
  license: cliSourceManifest.license,
  repository: cliSourceManifest.repository,
  homepage: cliSourceManifest.homepage,
  bugs: cliSourceManifest.bugs,
  type: cliSourceManifest.type,
  bin: cliSourceManifest.bin,
  files: ['bin', 'template', 'README.md', 'LICENSE'],
  engines: cliSourceManifest.engines,
  publishConfig: { access: 'public' },
}
assertBasePublishManifest(cliManifest)
if (cliManifest.name !== 'create-worlddevkit') throw new Error('Refusing to stage an unexpected CLI package name')
if (!cliManifest.bin?.['create-worlddevkit']) throw new Error('create-worlddevkit is missing its executable')
await mkdir(cliTargetDirectory, { recursive: true })
await Promise.all([
  cp(resolve(cliSourceDirectory, 'bin'), resolve(cliTargetDirectory, 'bin'), { recursive: true }),
  cp(resolve(cliSourceDirectory, 'template'), resolve(cliTargetDirectory, 'template'), { recursive: true }),
  cp(resolve(cliSourceDirectory, 'README.md'), resolve(cliTargetDirectory, 'README.md')),
  cp(resolve(cliSourceDirectory, 'LICENSE'), resolve(cliTargetDirectory, 'LICENSE')),
  writeFile(resolve(cliTargetDirectory, 'package.json'), `${JSON.stringify(cliManifest, null, 2)}\n`),
])

console.log(`Staged WorldKit ${version} in ${outputRoot}`)

function rewriteDependencies(dependencies, releaseVersion) {
  return Object.fromEntries(Object.entries(dependencies).map(([name, range]) => [
    name,
    internalNames.has(name) ? releaseVersion : range,
  ]))
}

function assertBasePublishManifest(manifest) {
  if (manifest.private !== undefined) throw new Error(`${manifest.name} staged manifest must not contain private`)
  const serialized = JSON.stringify(manifest)
  if (/"(?:file|link|workspace):/.test(serialized)) {
    throw new Error(`${manifest.name} contains a local dependency protocol`)
  }
}

function assertLibraryPublishManifest(manifest) {
  assertBasePublishManifest(manifest)
  if (!manifest.name?.startsWith('@worlddevkit/')) throw new Error('Refusing to stage an unexpected package name')
  for (const required of ['main', 'types', 'exports']) {
    if (!manifest[required]) throw new Error(`${manifest.name} is missing ${required}`)
  }
}
