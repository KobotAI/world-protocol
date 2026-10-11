import { createServer, type IncomingHttpHeaders } from 'node:http'
import { Readable } from 'node:stream'
import { fetchWorld } from './world.js'

const port = parsePort(process.env.PORT)
const host = process.env.HOST ?? '127.0.0.1'

const server = createServer(async (incoming, outgoing) => {
  try {
    const authority = incoming.headers.host ?? `localhost:${port}`
    const url = new URL(incoming.url ?? '/', `http://${authority}`)
    const method = incoming.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: toHeaders(incoming.headers),
    }

    if (hasBody) {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      init.duplex = 'half'
    }

    const response = await fetchWorld(new Request(url, init))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error(error)
    outgoing.writeHead(500, { 'content-type': 'application/json' })
    outgoing.end(JSON.stringify({ code: 'internal_error', message: 'Unexpected server error' }))
  }
})

server.listen(port, host, () => {
  console.log(`World listening on http://${host}:${port}`)
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
