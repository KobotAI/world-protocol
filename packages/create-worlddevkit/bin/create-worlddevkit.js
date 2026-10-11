#!/usr/bin/env node

import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const templateDirectory = resolve(packageRoot, 'template')
const packageManifestPath = resolve(packageRoot, 'package.json')

const HELP = `Create a WorldDevKit TypeScript world.

Usage:
  create-worlddevkit <project-directory>

Options:
  -h, --help       Show this help
  -v, --version    Show the package version
`

class UsageError extends Error {}

export async function main(argv = process.argv.slice(2), io = console) {
  try {
    const parsed = parseArguments(argv)

    if (parsed.help) {
      io.log(HELP.trimEnd())
      return 0
    }
    if (parsed.version) {
      const manifest = JSON.parse(await readFile(packageManifestPath, 'utf8'))
      io.log(manifest.version)
      return 0
    }

    const projectArgument = parsed.projectDirectory
    if (projectArgument === undefined) {
      throw new UsageError('Missing project directory.\n\n' + HELP.trimEnd())
    }

    const { packageName, targetDirectory } = validateProjectDirectory(projectArgument)
    await generateProject(targetDirectory, packageName)

    const displayPath = isAbsolute(projectArgument)
      ? targetDirectory
      : projectArgument.replace(/[\\/]+$/, '')
    io.log(`Created ${packageName} in ${displayPath}\n`)
    io.log('Next steps:')
    io.log(`  cd ${shellQuote(displayPath)}`)
    io.log('  npm install')
    io.log('  npm run dev')
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.error(`Error: ${message}`)
    return 1
  }
}

export function parseArguments(argv) {
  const positionals = []
  let help = false
  let version = false
  let optionsEnded = false

  for (const argument of argv) {
    if (!optionsEnded && argument === '--') {
      optionsEnded = true
    } else if (!optionsEnded && (argument === '--help' || argument === '-h')) {
      help = true
    } else if (!optionsEnded && (argument === '--version' || argument === '-v')) {
      version = true
    } else if (!optionsEnded && argument.startsWith('-')) {
      throw new UsageError(`Unknown option: ${argument}`)
    } else {
      positionals.push(argument)
    }
  }

  if (positionals.length > 1) {
    throw new UsageError('Expected exactly one project directory.')
  }
  if ((help || version) && positionals.length > 0) {
    throw new UsageError('Help and version options cannot be combined with a project directory.')
  }
  if (help && version) {
    throw new UsageError('Choose either --help or --version.')
  }

  return { help, version, projectDirectory: positionals[0] }
}

export function validateProjectDirectory(projectArgument) {
  if (projectArgument.length === 0 || projectArgument.trim() !== projectArgument) {
    throw new UsageError('Project directory cannot be empty or have leading/trailing whitespace.')
  }
  if (/[\0-\x1f\x7f]/.test(projectArgument)) {
    throw new UsageError('Project directory contains control characters.')
  }
  if (projectArgument.includes('\\')) {
    throw new UsageError('Project directory must use forward slashes.')
  }

  const pathSegments = projectArgument.split('/')
  if (pathSegments.includes('..')) {
    throw new UsageError('Project directory cannot contain ".." path traversal segments.')
  }

  const targetDirectory = resolve(projectArgument)
  const packageName = basename(targetDirectory)
  validatePackageName(packageName)
  return { packageName, targetDirectory }
}

function validatePackageName(name) {
  if (name.length > 214) {
    throw new UsageError('Project name must be 214 characters or fewer.')
  }
  if (name === 'node_modules' || name === 'favicon.ico') {
    throw new UsageError(`Invalid npm package name: ${name}`)
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new UsageError(
      `Invalid npm package name: ${name || '(empty)'}. Use lowercase letters, numbers, dots, hyphens, or underscores, starting with a letter or number.`,
    )
  }
}

async function generateProject(targetDirectory, packageName) {
  await assertTargetAvailable(targetDirectory)
  const parentDirectory = dirname(targetDirectory)
  await mkdir(parentDirectory, { recursive: true })
  const stagingDirectory = await mkdtemp(resolve(parentDirectory, '.create-worlddevkit-'))
  await rmdir(stagingDirectory)

  try {
    await cp(templateDirectory, stagingDirectory, { recursive: true })
    await rename(
      resolve(stagingDirectory, 'gitignore'),
      resolve(stagingDirectory, '.gitignore'),
    )
    await customizeManifest(stagingDirectory, packageName)

    const targetState = await getTargetState(targetDirectory)
    if (targetState === 'empty-directory') {
      await rmdir(targetDirectory)
    } else if (targetState !== 'missing') {
      throw new UsageError(`Target directory is not empty: ${targetDirectory}`)
    }

    await rename(stagingDirectory, targetDirectory)
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

async function assertTargetAvailable(targetDirectory) {
  const state = await getTargetState(targetDirectory)
  if (state === 'missing' || state === 'empty-directory') return
  if (state === 'symlink') {
    throw new UsageError(`Target path cannot be a symbolic link: ${targetDirectory}`)
  }
  if (state === 'file') {
    throw new UsageError(`Target path is not a directory: ${targetDirectory}`)
  }
  throw new UsageError(`Target directory is not empty: ${targetDirectory}`)
}

async function getTargetState(targetDirectory) {
  try {
    const stats = await lstat(targetDirectory)
    if (stats.isSymbolicLink()) return 'symlink'
    if (!stats.isDirectory()) return 'file'
    return (await readdir(targetDirectory)).length === 0 ? 'empty-directory' : 'non-empty-directory'
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function customizeManifest(stagingDirectory, packageName) {
  const manifestPath = resolve(stagingDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.name = packageName
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

function shellQuote(value) {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

if (await isMainModule()) {
  process.exitCode = await main()
}

async function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}
