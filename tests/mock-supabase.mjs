// Tiny PostgREST-compatible mock server for supabase-js.
// Listens on PORT (default 54321) and stores data in-memory.
// Supports: GET/POST/PATCH/DELETE on /rest/v1/<table>, eq/ilike/in filters,
// order, Accept: application/vnd.pgrst.object+json (single mode), select().
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT || 54321)

const db = {
  calendars: [],
  participants: [],
  blocks: [],
  messages: [],
}

function parseFilters(searchParams) {
  const filters = []
  for (const [k, v] of searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    const m = /^([a-z]+)\.(.+)$/.exec(v)
    if (!m) continue
    filters.push({ col: k, op: m[1], val: decodeURIComponent(m[2]) })
  }
  return filters
}

function applyFilters(rows, filters) {
  return rows.filter((r) => {
    for (const f of filters) {
      const val = r[f.col]
      if (f.op === 'eq') {
        if (String(val) !== f.val) return false
      } else if (f.op === 'ilike') {
        const pat = f.val.replace(/%/g, '').toLowerCase()
        if (typeof val !== 'string' || !val.toLowerCase().includes(pat)) return false
      } else if (f.op === 'in') {
        // val format: (a,b,c)
        const opts = f.val.replace(/^\(|\)$/g, '').split(',')
        if (!opts.includes(String(val))) return false
      } else if (f.op === 'is') {
        if (f.val === 'null' && val !== null && val !== undefined) return false
      }
    }
    return true
  })
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type,apikey,prefer,range,accept,accept-profile,content-profile,x-client-info,x-supabase-api-version',
    'Access-Control-Expose-Headers': 'content-range',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)

  // Health check
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
    return res.end(JSON.stringify({ ok: true, db }))
  }

  const pathMatch = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)
  if (!pathMatch) {
    res.writeHead(404, { 'Content-Type': 'application/json', ...cors })
    return res.end(JSON.stringify({ message: 'unknown path' }))
  }
  const table = pathMatch[1]
  if (!(table in db)) db[table] = []
  const filters = parseFilters(url.searchParams)
  const accept = req.headers['accept'] || ''
  const wantsSingle = accept.includes('application/vnd.pgrst.object+json')
  const prefer = req.headers['prefer'] || ''
  const wantsRepresentation = prefer.includes('return=representation')
  const sendJson = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors })
    res.end(JSON.stringify(body))
  }

  try {
    if (req.method === 'GET') {
      let rows = applyFilters(db[table], filters)
      const order = url.searchParams.get('order')
      if (order) {
        const [col, dir = 'asc'] = order.split('.')
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0
          return (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1)
        })
      }
      if (wantsSingle) {
        if (rows.length === 0) return sendJson(406, { code: 'PGRST116', message: 'No rows' })
        if (rows.length > 1) return sendJson(406, { code: 'PGRST116', message: 'Multiple rows' })
        return sendJson(200, rows[0])
      }
      return sendJson(200, rows)
    }

    if (req.method === 'POST') {
      const bodyText = await readBody(req)
      const payload = bodyText ? JSON.parse(bodyText) : []
      const items = Array.isArray(payload) ? payload : [payload]
      const now = new Date().toISOString()
      const inserted = items.map((it) => ({
        id: it.id || randomUUID(),
        created_at: now,
        updated_at: now,
        is_locked: false,
        is_infinite: false,
        is_submitted: false,
        host_participant_id: null,
        ...it,
      }))
      db[table].push(...inserted)
      if (!wantsRepresentation) {
        res.writeHead(201, cors)
        return res.end()
      }
      if (wantsSingle) return sendJson(201, inserted[0])
      return sendJson(201, inserted)
    }

    if (req.method === 'PATCH') {
      const bodyText = await readBody(req)
      const updates = JSON.parse(bodyText || '{}')
      const rows = applyFilters(db[table], filters)
      const now = new Date().toISOString()
      for (const r of rows) Object.assign(r, updates, { updated_at: now })
      if (!wantsRepresentation) {
        res.writeHead(204, cors)
        return res.end()
      }
      if (wantsSingle) {
        if (rows.length !== 1) return sendJson(406, { message: 'expected single row' })
        return sendJson(200, rows[0])
      }
      return sendJson(200, rows)
    }

    if (req.method === 'DELETE') {
      const keep = []
      const removed = []
      for (const r of db[table]) {
        const match = applyFilters([r], filters).length > 0
        if (match) removed.push(r)
        else keep.push(r)
      }
      db[table] = keep
      if (!wantsRepresentation) {
        res.writeHead(204, cors)
        return res.end()
      }
      return sendJson(200, removed)
    }

    res.writeHead(405, cors)
    res.end()
  } catch (e) {
    sendJson(500, { message: e.message, stack: e.stack })
  }
})

server.listen(PORT, () => {
  console.log(`mock-supabase listening on http://localhost:${PORT}`)
})
