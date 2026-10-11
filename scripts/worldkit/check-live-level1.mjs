import { runLevel1Conformance } from '../../packages/worldkit-testing/dist/index.js'

const world = process.argv[2] ?? process.env.WORLD_URL
const timeoutMs = Number.parseInt(process.env.WORLDKIT_CONFORMANCE_TIMEOUT_MS ?? '600000', 10)

if (!world) {
  throw new Error('Pass a world origin as the first argument or set WORLD_URL')
}

if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error('WORLDKIT_CONFORMANCE_TIMEOUT_MS must be a positive integer')
}

const timeout = AbortSignal.timeout(timeoutMs)
const fetchWithTimeout = (input, init = {}) => fetch(input, { ...init, signal: init.signal ?? timeout })

console.log(`Running World Protocol Level 1 conformance against ${world}`)

const report = await runLevel1Conformance(
  { world, fetch: fetchWithTimeout },
  { pageSize: 50, maxPagesPerType: 1_000 },
)

for (const check of report.checks) {
  const status = check.passed ? 'PASS' : 'FAIL'
  console.log(`${status} ${check.name} (${check.durationMs}ms)${check.error ? `: ${check.error}` : ''}`)
}

console.log(JSON.stringify(report, null, 2))

if (!report.passed) process.exitCode = 1
