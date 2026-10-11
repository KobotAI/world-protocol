#!/usr/bin/env node

import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const packageNames = ['core', 'geo', 'spec', 'server', 'client', 'testing', 'create-worlddevkit']
const [inputArgument = '.worldkit-release/staged', outputArgument = '.worldkit-release/tarballs'] = process.argv.slice(2)
const repositoryRoot = resolve(import.meta.dirname, '../..')
const inputRoot = resolve(repositoryRoot, inputArgument)
const outputRoot = resolve(repositoryRoot, outputArgument)

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
for (const shortName of packageNames) {
  await run('npm', ['pack', resolve(inputRoot, shortName), '--pack-destination', outputRoot, '--json'], repositoryRoot)
}
console.log(`Packed WorldKit tarballs in ${outputRoot}`)

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with status ${String(code)}`)))
  })
}
