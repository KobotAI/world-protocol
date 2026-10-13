/**
 * Node.js-only helpers. Imported from `@worlddevkit/server/node` so the main entry point stays
 * free of `node:` modules and keeps running on any Fetch-compatible runtime.
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StaticHandlerOptions {
  /** Directory to serve, as a path or a `file:` URL. */
  root: string | URL
  /** File served for a directory request. Defaults to `index.html`. */
  index?: string
  /**
   * File served when an extensionless path has no matching file, so client-side routes such as
   * `/places/central-garden` load the app. Defaults to `index.html`. Set `false` to answer 404.
   */
  fallback?: string | false
  /** Cache-Control for every file. Defaults to `no-cache`, which revalidates on each load. */
  cacheControl?: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
}

/**
 * Serve a directory of static files (a world's website) as a Fetch handler.
 *
 * Only GET and HEAD are answered. Paths that escape `root`, including through symlinks, are
 * answered with 404 rather than read.
 */
export function createStaticHandler(options: StaticHandlerOptions): (request: Request) => Promise<Response> {
  const root = resolve(typeof options.root === 'string' ? options.root : fileURLToPath(options.root))
  const index = options.index ?? 'index.html'
  const fallback = options.fallback === undefined ? 'index.html' : options.fallback
  const cacheControl = options.cacheControl ?? 'no-cache'
  let realRoot: Promise<string> | undefined

  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(405, 'Method not allowed', { Allow: 'GET, HEAD' })
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return text(400, 'Bad request')
    }
    if (pathname.includes('\0')) return text(400, 'Bad request')

    realRoot ??= realpath(root)
    const base = await realRoot.catch(() => null)
    if (base === null) return text(404, 'Not found')

    let file = await resolveFile(base, pathname, index)
    if (file === null && fallback !== false && extname(pathname) === '') {
      file = await resolveFile(base, `/${fallback}`, index)
    }
    if (file === null) return text(404, 'Not found')

    const body = await readFile(file)
    const headers = new Headers({
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers })
  }
}

async function resolveFile(base: string, pathname: string, index: string): Promise<string | null> {
  const candidate = resolve(base, `.${pathname}`)
  if (!isInside(base, candidate)) return null
  try {
    let real = await realpath(candidate)
    if (!isInside(base, real)) return null
    let info = await stat(real)
    if (info.isDirectory()) {
      real = await realpath(resolve(real, index))
      if (!isInside(base, real)) return null
      info = await stat(real)
    }
    return info.isFile() ? real : null
  } catch {
    return null
  }
}

function isInside(base: string, candidate: string): boolean {
  return candidate === base || candidate.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

function text(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}
