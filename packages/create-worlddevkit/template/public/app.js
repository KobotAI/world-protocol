// Starter website for this world. It reads everything through the World Protocol API, so what
// visitors see is always what other software sees. Reshape it into the explore experience your
// world needs (a map, a scene, a timeline...), and keep the list/search view as the accessible
// path through the same entities.

const main = document.querySelector('#main')
const DETAIL_ATTRIBUTES_HIDDEN = new Set(['name', 'description', 'category', 'tagline'])

const state = {
  discovery: null,
  apiPath: '',
  entities: [],
  byKey: new Map(),
  query: '',
  category: '',
  error: null,
}

window.addEventListener('hashchange', () => render({ moveFocus: true }))
start()

async function start() {
  state.error = null
  showStatus('Loading the world…', { busy: true })
  try {
    state.discovery = await getJson('/.well-known/world.json')
    // Discovery names the API; never hardcode it. The website shares this world's origin, so it
    // uses only the path, which also works when the server runs on another local port.
    state.apiPath = new URL(state.discovery.endpoints.api).pathname.replace(/\/+$/, '')
    state.entities = await loadAllEntities(state.discovery.entityTypes)
    state.byKey = new Map(state.entities.map((entity) => [key(entity.ref.type, entity.ref.id), entity]))
    document.querySelectorAll('[data-world-name]').forEach((node) => { node.textContent = state.discovery.name })
  } catch (error) {
    state.error = error
  }
  render({ moveFocus: false })
}

async function loadAllEntities(types) {
  const all = []
  for (const type of types) {
    let cursor = null
    do {
      const params = new URLSearchParams({ limit: '50' })
      if (cursor) params.set('cursor', cursor) // Cursors are opaque: pass them back unchanged.
      const page = await getJson(`${state.apiPath}/entities/${encodeURIComponent(type)}?${params}`)
      all.push(...page.entities)
      cursor = page.nextCursor
    } while (cursor)
  }
  return all
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return response.json()
}

// ---------------------------------------------------------------------------------------------
// Routing: #/ is the explore view, #/<type>/<id> is an entity's detail view.

function render({ moveFocus }) {
  main.setAttribute('aria-busy', 'false')
  if (state.error) return showError()

  const [type, id] = location.hash.replace(/^#\/?/, '').split('/').map(safeDecode)
  if (type && id) {
    const entity = state.byKey.get(key(type, id))
    entity ? showDetail(entity) : showNotFound()
  } else {
    showExplore()
  }
  if (moveFocus) main.querySelector('h1')?.focus()
}

function showExplore() {
  const { discovery } = state
  document.title = discovery.name
  const categories = [...new Set(state.entities.map((entity) => entity.attributes.category).filter(isText))].sort()

  const search = el('input', { id: 'search', type: 'search', value: state.query, autocomplete: 'off', placeholder: 'Search by name or description' })
  const filter = el('select', { id: 'category' },
    el('option', { value: '' }, 'All categories'),
    ...categories.map((category) => el('option', { value: category, selected: category === state.category }, label(category))),
  )
  const count = el('p', { class: 'count', 'aria-live': 'polite' })
  const results = el('ul', { class: 'results' })

  const update = () => {
    state.query = search.value
    state.category = filter.value
    const matches = filterEntities()
    results.replaceChildren(...matches.map(resultItem))
    count.textContent = matches.length === 0
      ? 'Nothing matches. Try a different search or category.'
      : `${matches.length} of ${state.entities.length} shown`
  }
  search.addEventListener('input', update)
  filter.addEventListener('change', update)

  main.replaceChildren(
    el('h1', { tabindex: '-1' }, discovery.name),
    discovery.description ? el('p', { class: 'lede' }, discovery.description) : '',
    el('form', { class: 'controls', role: 'search', onsubmit: (event) => event.preventDefault() },
      el('div', { class: 'field' }, el('label', { for: 'search' }, 'Search'), search),
      el('div', { class: 'field' }, el('label', { for: 'category' }, 'Category'), filter),
    ),
    count,
    results,
  )
  update()
}

function filterEntities() {
  const query = state.query.trim().toLowerCase()
  return state.entities.filter((entity) => {
    const { name, description, category } = entity.attributes
    if (state.category && category !== state.category) return false
    if (!query) return true
    return [name, description, category].some((value) => isText(value) && value.toLowerCase().includes(query))
  })
}

function resultItem(entity) {
  const { description, category } = entity.attributes
  return el('li', { class: 'result' },
    el('a', { href: entityHref(entity.ref) },
      isText(category) ? el('span', { class: 'tag' }, label(category)) : '',
      el('span', { class: 'result-name' }, displayName(entity)),
      isText(description) ? el('span', { class: 'result-description' }, description) : '',
    ),
  )
}

function showDetail(entity) {
  const { description, category } = entity.attributes
  document.title = `${displayName(entity)} · ${state.discovery.name}`

  const facts = Object.entries(entity.attributes)
    .filter(([name, value]) => !DETAIL_ATTRIBUTES_HIDDEN.has(name) && isPrimitive(value))
  const related = entity.relationships

  main.replaceChildren(
    el('a', { class: 'back', href: '#/' }, '← All of ' + state.discovery.name),
    isText(category) ? el('p', { class: 'tag' }, label(category)) : '',
    el('h1', { tabindex: '-1' }, displayName(entity)),
    isText(description) ? el('p', { class: 'lede' }, description) : '',
    facts.length ? el('h2', {}, 'Details') : '',
    facts.length ? el('dl', { class: 'facts' }, ...facts.flatMap(([name, value]) => [el('dt', {}, label(name)), el('dd', {}, String(value))])) : '',
    related.length ? el('h2', {}, 'Related') : '',
    related.length ? el('ul', { class: 'related' }, ...related.map(relatedItem)) : '',
  )
}

function relatedItem({ rel, target }) {
  const local = target.world === undefined || target.world === state.discovery.id
  const entity = local ? state.byKey.get(key(target.type, target.id)) : undefined
  const name = entity ? displayName(entity) : target.id
  return el('li', {},
    el('span', { class: 'rel' }, `${label(rel)}: `),
    entity ? el('a', { href: entityHref(entity.ref) }, name) : el('span', {}, name),
  )
}

function showNotFound() {
  document.title = `Not found · ${state.discovery.name}`
  main.replaceChildren(
    el('h1', { tabindex: '-1' }, 'Not found'),
    el('p', { class: 'lede' }, 'Nothing in this world has that address. It may have moved or been removed.'),
    el('a', { href: '#/' }, 'Explore everything instead'),
  )
}

function showError() {
  document.title = 'Unavailable'
  main.replaceChildren(
    el('h1', { tabindex: '-1' }, 'This world is unavailable'),
    el('p', { class: 'lede' }, 'We could not load it just now. Check your connection and try again.'),
    el('button', { type: 'button', onclick: start }, 'Try again'),
  )
  console.error(state.error)
}

function showStatus(message, { busy }) {
  main.setAttribute('aria-busy', String(busy))
  main.replaceChildren(
    el('section', { class: 'status', role: 'status' },
      busy ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : '',
      el('p', {}, message),
    ),
  )
}

// ---------------------------------------------------------------------------------------------
// Helpers

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value)
    else if (name === 'value') node.value = value
    else if (name === 'selected') node.selected = Boolean(value)
    else if (value !== false && value !== undefined && value !== null) node.setAttribute(name, value)
  }
  node.append(...children.filter((child) => child !== ''))
  return node
}

function entityHref(ref) {
  return `#/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`
}

function displayName(entity) {
  return isText(entity.attributes.name) ? entity.attributes.name : entity.ref.id
}

function label(value) {
  const text = String(value).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function key(type, id) {
  return `${type}\u0000${id}`
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isText(value) {
  return typeof value === 'string' && value.length > 0
}

function isPrimitive(value) {
  return ['string', 'number', 'boolean'].includes(typeof value)
}
