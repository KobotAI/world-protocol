import { WorldClient, discoverWorld, type Fetch } from '@worlddevkit/client'
import type { EntityEnvelope } from '@worlddevkit/spec'

export interface AssetConformanceReport {
  passed: boolean
  world: string
  /** How many wp:asset and wp:placement entities were checked. */
  checked: { assets: number; placements: number }
  problems: string[]
}

/**
 * Checks a world's shared assets and placements: every `wp:asset` has a name, an https image
 * with alt text and a link back; every public `wp:placement` names its source, carries a
 * "presented by" sponsorship and links back. Worlds without either type pass trivially.
 */
export async function runAssetConformance(target: { world: string | URL; fetch?: Fetch }): Promise<AssetConformanceReport> {
  const fetch = (target.fetch ?? globalThis.fetch).bind(globalThis) as Fetch
  const discovery = await discoverWorld(target.world, { fetch })
  const client = new WorldClient(discovery, { fetch })
  const problems: string[] = []
  const local = /^http:\/\/(localhost|127\.)/.test(discovery.id)
  const url = (value: unknown) => typeof value === 'string' && (value.startsWith('https://') || (local && value.startsWith('http://')))
  let assets = 0
  let placements = 0

  if (discovery.entityTypes.includes('wp:asset')) {
    if (!discovery.extensions?.includes('wp:assets')) problems.push('A world with wp:asset entities must list "wp:assets" in extensions')
    for await (const entity of client.entities('wp:asset')) {
      assets += 1
      const a = entity.attributes as Record<string, any>
      const at = `wp:asset/${entity.ref.id}`
      if (typeof a.name !== 'string' || !a.name.trim()) problems.push(`${at} needs a name`)
      if (!url(a.image?.url)) problems.push(`${at} needs an https image.url`)
      if (typeof a.image?.alt !== 'string' || !a.image.alt.trim()) problems.push(`${at} needs image.alt text`)
      if (!url(entity.links?.web)) problems.push(`${at} needs an https links.web to the real thing`)
      if (a.model != null && (a.model.format !== 'glb' || !url(a.model.url) || !Number.isSafeInteger(a.model.bytes) || a.model.bytes > 10_000_000)) {
        problems.push(`${at} model must be { url: https, format: "glb", bytes <= 10000000 }`)
      }
    }
  }

  if (discovery.entityTypes.includes('wp:placement')) {
    if (!discovery.extensions?.includes('wp:placements')) problems.push('A world with wp:placement entities must list "wp:placements" in extensions')
    for (const action of ['wp:offer', 'wp:accept', 'wp:remove']) {
      if (!discovery.actions?.includes(action)) problems.push(`A placement host must advertise ${action}`)
    }
    for await (const entity of client.entities('wp:placement')) {
      placements += 1
      checkPlacement(entity, problems, url)
    }
  }

  return { passed: problems.length === 0, world: discovery.id, checked: { assets, placements }, problems }
}

function checkPlacement(entity: EntityEnvelope, problems: string[], url: (value: unknown) => boolean): void {
  const a = entity.attributes as Record<string, any>
  const at = `wp:placement/${entity.ref.id}`
  if (a.status !== 'placed') problems.push(`${at} is public but its status is "${a.status}", not "placed"`)
  if (!url(a.source?.world) || typeof a.source?.id !== 'string') problems.push(`${at} must name its source world and asset id`)
  if (a.source?.world === entity.ref.world) problems.push(`${at} must show an asset from another world`)
  const shows = entity.relationships.find((relationship) => relationship.rel === 'shows')
  if (!shows || shows.target.world !== a.source?.world || shows.target.id !== a.source?.id) problems.push(`${at} needs a "shows" relationship to its source asset`)
  const sponsorship = entity.sponsorship as Record<string, any> | undefined
  if (!sponsorship || typeof sponsorship.sponsor?.name !== 'string' || !['presented_by', 'sponsored'].includes(sponsorship.label)) {
    problems.push(`${at} must carry a sponsorship label naming the source world`)
  }
  if (!url(entity.links?.web)) problems.push(`${at} needs links.web back to the real thing`)
  if (typeof a.asset?.name !== 'string' || !url(a.asset?.image?.url)) problems.push(`${at} needs the asset's name and image`)
}
