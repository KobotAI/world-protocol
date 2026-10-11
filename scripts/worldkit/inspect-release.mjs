#!/usr/bin/env node

import { constants } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const libraryPackageNames = ['core', 'geo', 'spec', 'server', 'client', 'testing']
const [version, inputArgument = '.worldkit-release/staged'] = process.argv.slice(2)
if (!version) throw new Error('Usage: node scripts/worldkit/inspect-release.mjs <version> [staged-directory]')

const repositoryRoot = resolve(import.meta.dirname, '../..')
const inputRoot = resolve(repositoryRoot, inputArgument)

for (const shortName of libraryPackageNames) {
  const directory = resolve(inputRoot, shortName)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (manifest.name !== `@worlddevkit/${shortName}`) throw new Error(`Unexpected package name in ${directory}`)
  if (manifest.version !== version) throw new Error(`${manifest.name} has version ${manifest.version}; expected ${version}`)
  if ('private' in manifest) throw new Error(`${manifest.name} must not include private in its staged manifest`)
  if (JSON.stringify(manifest).match(/"(?:file|link|workspace):/)) throw new Error(`${manifest.name} contains a local dependency protocol`)

  for (const dependencyVersion of Object.values(manifest.dependencies ?? {})) {
    if (typeof dependencyVersion !== 'string') throw new Error(`${manifest.name} has an invalid dependency range`)
  }
  for (const [dependency, dependencyVersion] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith('@worlddevkit/') && dependencyVersion !== version) {
      throw new Error(`${manifest.name} must depend on ${dependency}@${version}, received ${dependencyVersion}`)
    }
  }

  await Promise.all(['README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'].map((path) => access(resolve(directory, path))))
  const files = await walk(directory)
  const forbidden = files.find((path) =>
    /(?:^|\/)(?:src|node_modules)(?:\/|$)|\.test\./.test(path)
      || path.endsWith('.tsx')
      || (path.endsWith('.ts') && !path.endsWith('.d.ts'))
  )
  if (forbidden) throw new Error(`${manifest.name} contains forbidden publish payload: ${forbidden}`)
  console.log(`${manifest.name}: ${files.length} staged files verified`)
}

const cliDirectory = resolve(inputRoot, 'create-worlddevkit')
const cliManifest = JSON.parse(await readFile(resolve(cliDirectory, 'package.json'), 'utf8'))
if (cliManifest.name !== 'create-worlddevkit') throw new Error(`Unexpected package name in ${cliDirectory}`)
if (cliManifest.version !== version) throw new Error(`${cliManifest.name} has version ${cliManifest.version}; expected ${version}`)
if ('private' in cliManifest) throw new Error(`${cliManifest.name} must not include private in its staged manifest`)
if (JSON.stringify(cliManifest).match(/"(?:file|link|workspace):/)) throw new Error(`${cliManifest.name} contains a local dependency protocol`)
if (cliManifest.bin?.['create-worlddevkit'] !== './bin/create-worlddevkit.js') {
  throw new Error(`${cliManifest.name} has an invalid executable declaration`)
}

const cliRequiredFiles = [
  'README.md',
  'LICENSE',
  'bin/create-worlddevkit.js',
  'template/.env.example',
  'template/gitignore',
  'template/package.json',
  'template/README.md',
  'template/AGENTS.md',
  'template/tsconfig.json',
  'template/src/server.ts',
  'template/src/world.ts',
  'template/test/conformance.test.ts',
]
await Promise.all(cliRequiredFiles.map((path) => access(resolve(cliDirectory, path))))
await access(resolve(cliDirectory, 'bin/create-worlddevkit.js'), constants.X_OK)
const cliFiles = await walk(cliDirectory)
const forbiddenCliFile = cliFiles.find((path) => /(?:^|\/)node_modules(?:\/|$)/.test(path))
if (forbiddenCliFile) throw new Error(`${cliManifest.name} contains forbidden publish payload: ${forbiddenCliFile}`)
for (const jsonPath of cliFiles.filter((path) => path.endsWith('.json'))) {
  const contents = await readFile(resolve(cliDirectory, jsonPath), 'utf8')
  if (/"(?:file|link|workspace):/.test(contents)) {
    throw new Error(`${cliManifest.name} contains a local dependency protocol in ${jsonPath}`)
  }
}
console.log(`${cliManifest.name}: ${cliFiles.length} staged files verified`)

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await walk(resolve(directory, entry.name), relative))
    else files.push(relative)
  }
  return files.sort()
}
