import { createServer, type IncomingHttpHeaders } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { handleRequest } from './app.js'

const port = parsePort(process.env.PORT)
const host = process.env.HOST ?? '127.0.0.1'

const server = createServer(async (incoming, outgoing) => {
  // Abort the request when the client goes away, so long-lived responses (the events stream)
  // stop and release their resources.
  const controller = new AbortController()
  outgoing.on('close', () => controller.abort())

  try {
    const authority = incoming.headers.host ?? `localhost:${port}`
    const url = new URL(incoming.url ?? '/', `http://${authority}`)
    const method = incoming.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: toHeaders(incoming.headers),
      signal: controller.signal,
    }

    if (hasBody) {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      init.duplex = 'half'
    }

    const response = await handleRequest(new Request(url, init))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body || method === 'HEAD') {
      outgoing.end()
      return
    }
    // Stream the body instead of buffering it, so events reach clients as they happen.
    outgoing.flushHeaders()
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), outgoing).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error(error)
    })
  } catch (error) {
    console.error(error)
    if (outgoing.headersSent) {
      outgoing.destroy()
      return
    }
    outgoing.writeHead(500, { 'content-type': 'application/json' })
    outgoing.end(JSON.stringify({ code: 'internal_error', message: 'Unexpected server error' }))
  }
})

server.listen(port, host, () => {
  console.log(`World listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
})

function toHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  return headers
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '8787')
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return parsed
}
