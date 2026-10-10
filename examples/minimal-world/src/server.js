import { createServer } from 'node:http'
import { fetchWorld } from './world.js'

const port = 8787

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? `localhost:${port}`}`)
    const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD'
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(hasBody ? { body: incoming, duplex: 'half' } : {}),
    })
    const response = await fetchWorld(request)

    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error(error)
    outgoing.writeHead(500, { 'content-type': 'application/json' })
    outgoing.end(JSON.stringify({ code: 'internal_error', message: 'Unexpected server error' }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Minimal World listening on http://localhost:${port}`)
})
