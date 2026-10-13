import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createStaticHandler } from '@worlddevkit/server/node'
import { world } from './world.js'

// `public/` sits next to `src/` in development and two levels above `dist/src/` after a build.
const publicDirectory = ['../public/', '../../public/']
  .map((path) => fileURLToPath(new URL(path, import.meta.url)))
  .find((path) => existsSync(path)) ?? fileURLToPath(new URL('../public/', import.meta.url))

const site = createStaticHandler({ root: publicDirectory })

/**
 * Every request to this world: protocol paths go to the Level 1 API, everything else is the
 * website in `public/`. Add your own routes here if the brief needs them.
 */
export async function handleRequest(request: Request): Promise<Response> {
  return world.handles(request.url) ? world.fetch(request) : site(request)
}
