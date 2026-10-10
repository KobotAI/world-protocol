#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageNames = ['spec', 'server', 'client', 'testing']
const [version, inputArgument = '.worldkit-release/staged'] = process.argv.slice(2)
if (!version) throw new Error('Usage: node scripts/worldkit/inspect-release.mjs <version> [staged-directory]')

const repositoryRoot = resolve(import.meta.dirname, '../..')
const inputRoot = resolve(repositoryRoot, inputArgument)

for (const shortName of packageNames) {
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
