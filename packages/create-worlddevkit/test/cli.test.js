import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(packageRoot, 'bin', 'create-worlddevkit.js')
const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'create-worlddevkit-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function run(args, cwd, executable = cli) {
  const env = { ...process.env, NO_COLOR: '1' }
  delete env.FORCE_COLOR
  return spawnSync(process.execPath, [executable, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  })
}

test('--help prints usage without creating files', async (t) => {
  const cwd = await workspace(t)
  const result = run(['--help'], cwd)

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:\s+create-worlddevkit <project-directory>/)
  assert.equal(result.stderr, '')
  assert.deepEqual(await readdir(cwd), [])
})

test('--version prints the manifest version', async (t) => {
  const cwd = await workspace(t)
  const result = run(['--version'], cwd)

  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), packageManifest.version)
  assert.equal(result.stderr, '')
})

test('generates a complete starter, including dotfiles, without installing dependencies', async (t) => {
  const cwd = await workspace(t)
  const result = run(['places-world'], cwd)
  const project = join(cwd, 'places-world')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Created places-world/)
  assert.deepEqual(
    (await readdir(project)).sort(),
    ['.env.example', '.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'public', 'src', 'test', 'tsconfig.json'],
  )

  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'places-world')
  assert.equal(manifest.private, true)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.engines.node, '>=20')
  assert.deepEqual(manifest.scripts, {
    dev: 'tsx watch src/server.ts',
    build: 'tsc -p tsconfig.json',
    typecheck: 'tsc --noEmit -p tsconfig.json',
    test: 'npm run build --silent && node --test dist/test/conformance.test.js dist/test/site.test.js',
    conformance: 'npm run build --silent && node --test dist/test/conformance.test.js',
  })
  assert.equal(manifest.dependencies['@worlddevkit/client'], '^0.2.0')
  assert.equal(manifest.dependencies['@worlddevkit/server'], '^0.2.0')
  assert.equal(manifest.dependencies['@worlddevkit/spec'], '^0.2.0')
  assert.equal(manifest.devDependencies['@worlddevkit/testing'], '^0.2.0')
  assert.equal(manifest.dependencies.length, undefined)

  assert.match(await readFile(join(project, '.env.example'), 'utf8'), /^HOST=.*\nPORT=.*\nWORLD_URL=.*\n$/)
  assert.match(await readFile(join(project, '.gitignore'), 'utf8'), /^node_modules\//m)
  assert.match(await readFile(join(project, 'src', 'world.ts'), 'utf8'), /defineWorld/)
  assert.match(await readFile(join(project, 'src', 'data.ts'), 'utf8'), /wp:place/)
  assert.match(await readFile(join(project, 'src', 'app.ts'), 'utf8'), /createStaticHandler/)
  assert.match(await readFile(join(project, 'public', 'index.html'), 'utf8'), /<script type="module" src="\/app\.js">/)
  assert.match(await readFile(join(project, 'test', 'site.test.ts'), 'utf8'), /handleRequest/)
  assert.match(await readFile(join(project, 'test', 'conformance.test.ts'), 'utf8'), /assertLevel1Conformance/)
  await assert.rejects(readFile(join(project, 'package-lock.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(project, 'node_modules')), { code: 'ENOENT' })
})

test('runs through a package-manager-style executable symlink', async (t) => {
  const cwd = await workspace(t)
  const executable = join(cwd, 'create-worlddevkit')
  await symlink(cli, executable)

  const result = run(['linked-cli-world'], cwd, executable)

  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(await readFile(join(cwd, 'linked-cli-world', 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'linked-cli-world')
})

test('accepts a nested target whose final directory already exists and is empty', async (t) => {
  const cwd = await workspace(t)
  await mkdir(join(cwd, 'nested', 'empty-world'), { recursive: true })

  const result = run(['nested/empty-world'], cwd)

  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(await readFile(join(cwd, 'nested', 'empty-world', 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'empty-world')
})

test('rejects malformed invocation and unsafe project paths', async (t) => {
  const cwd = await workspace(t)
  const cases = [
    { args: [], message: /Missing project directory/ },
    { args: ['--wat'], message: /Unknown option: --wat/ },
    { args: ['one', 'two'], message: /exactly one project directory/ },
    { args: ['--help', '--wat'], message: /Unknown option: --wat/ },
    { args: ['Bad-Name'], message: /Invalid npm package name/ },
    { args: ['.hidden'], message: /Invalid npm package name/ },
    { args: ['space name'], message: /Invalid npm package name/ },
    { args: ['safe/../escape'], message: /path traversal segments/ },
    { args: ['safe\\escape'], message: /forward slashes/ },
  ]

  for (const { args, message } of cases) {
    const result = run(args, cwd)
    assert.equal(result.status, 1, `expected failure for ${JSON.stringify(args)}`)
    assert.match(result.stderr, message)
  }
  assert.deepEqual(await readdir(cwd), [])
})

test('refuses non-empty directories and preserves their contents', async (t) => {
  const cwd = await workspace(t)
  const target = join(cwd, 'existing-world')
  await mkdir(target)
  await writeFile(join(target, 'keep.txt'), 'do not overwrite\n')

  const result = run(['existing-world'], cwd)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /not empty/)
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'do not overwrite\n')
  assert.deepEqual(await readdir(target), ['keep.txt'])
})

test('refuses files and symbolic-link targets', async (t) => {
  const cwd = await workspace(t)
  await writeFile(join(cwd, 'file-world'), 'keep\n')
  await mkdir(join(cwd, 'real-world'))
  await symlink(join(cwd, 'real-world'), join(cwd, 'linked-world'))

  const fileResult = run(['file-world'], cwd)
  assert.equal(fileResult.status, 1)
  assert.match(fileResult.stderr, /not a directory/)
  assert.equal(await readFile(join(cwd, 'file-world'), 'utf8'), 'keep\n')

  const linkResult = run(['linked-world'], cwd)
  assert.equal(linkResult.status, 1)
  assert.match(linkResult.stderr, /symbolic link/)
  assert.deepEqual(await readdir(join(cwd, 'real-world')), [])
})
