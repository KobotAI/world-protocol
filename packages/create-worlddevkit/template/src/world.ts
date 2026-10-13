import { defineWorld } from '@worlddevkit/server'
import { entities } from './data.js'

const port = process.env.PORT ?? '8787'

/**
 * `WORLD_URL` is the public origin of this world. Locally it follows `PORT`, so discovery always
 * points at the server you are actually running. In production set it to the HTTPS origin.
 */
export const world = defineWorld({
  url: process.env.WORLD_URL ?? `http://localhost:${port}`,
  name: 'My World',
  description: 'A credential-free, in-memory World Protocol Level 1 world.',
  entities,
})

/** The discovery document served at `/.well-known/world.json`. */
export const discovery = world.discovery

/** Serves `/.well-known/world.json` and the Level 1 API under `/api/world/v0`. */
export const fetchWorld = world.fetch
