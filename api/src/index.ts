import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

type AppEnv = { Bindings: Env }
type AppContext = Context<AppEnv>

const MAX_NAME_LENGTH = 100
const MAX_KEY_LENGTH = 255

// ---------- Rows (snake_case, as stored) and responses (camelCase, as sent) ----------

type HomeRow = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }
type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  payment_key: string | null
}
type BalanceRow = { member_id: string; name: string; outstanding_cents: number }

type ShareDto = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type BillDto = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareDto[]
}

const toShareDto = (row: ShareRow): ShareDto => ({
  id: row.id,
  memberId: row.member_id,
  amountCents: row.amount_cents,
  paidAt: row.paid_at,
})

const toMemberDto = (row: MemberRow) => ({ id: row.id, homeId: row.home_id, name: row.name })

// ---------- Small helpers ----------

// An error we expect and know how to answer: it carries the HTTP status to send.
class ApiError extends Error {
  readonly status: ContentfulStatusCode

  constructor(status: ContentfulStatusCode, message: string) {
    super(message)
    this.status = status
  }
}

function fail(status: ContentfulStatusCode, message: string): ApiError {
  return new ApiError(status, message)
}

// Reads the JSON body. A body that is not valid JSON is a 400.
async function readBody(c: AppContext): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw fail(400, 'Request body must be valid JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw fail(400, 'Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

// A text field: a string, not empty after trimming, not too long.
function readText(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw fail(422, `${field} must be a non-empty string`)
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw fail(422, `${field} must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return trimmed
}

// Money: a JS number that is a whole number, positive, and safe to store exactly.
// Strings, null, decimals, NaN, 0 and negatives are all rejected.
function readTotalCents(body: Record<string, unknown>): number {
  const value = body.totalCents
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw fail(422, 'totalCents must be a positive whole number of cents')
  }
  return value
}

async function requireHome(db: D1Database, homeId: string): Promise<HomeRow> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?1')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) throw fail(404, 'Home not found')
  return home
}

async function loadShares(db: D1Database, billId: string): Promise<ShareRow[]> {
  const result = await db
    .prepare(
      `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.payment_key
       FROM shares s JOIN members m ON m.id = s.member_id
       WHERE s.bill_id = ?1
       ORDER BY m.seq`,
    )
    .bind(billId)
    .all<ShareRow>()
  return result.results
}

// ---------- App ----------

const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Part 1 --------------------------------------------------------------------------------

app.post('/api/homes', async (c) => {
  const body = await readBody(c)
  const name = readText(body, 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?1, ?2)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))
  const members = await c.env.DB.prepare(
    'SELECT id, home_id, name FROM members WHERE home_id = ?1 ORDER BY seq',
  )
    .bind(home.id)
    .all<MemberRow>()
  return c.json({ id: home.id, name: home.name, members: members.results.map(toMemberDto) })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c)
  const name = readText(body, 'name')
  const id = crypto.randomUUID()

  // One statement does everything: it checks the home exists AND picks the next position.
  // Two parallel adds cannot get the same position (and UNIQUE(home_id, seq) backs this up).
  const result = await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, seq)
     SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM members WHERE home_id = ?2)
     WHERE EXISTS (SELECT 1 FROM homes WHERE id = ?2)`,
  )
    .bind(id, homeId, name)
    .run()
  if (result.meta.changes === 0) throw fail(404, 'Home not found')

  return c.json({ id, homeId, name }, 201)
})

// Part 2 --------------------------------------------------------------------------------

app.get('/api/homes/:homeId/bills', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))
  const bills = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ?1 ORDER BY created_at DESC, rowid DESC',
  )
    .bind(home.id)
    .all<BillRow>()
  const shares = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.payment_key
     FROM shares s
     JOIN bills b ON b.id = s.bill_id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?1
     ORDER BY m.seq`,
  )
    .bind(home.id)
    .all<ShareRow>()

  const sharesByBill = new Map<string, ShareDto[]>()
  for (const share of shares.results) {
    const list = sharesByBill.get(share.bill_id) ?? []
    list.push(toShareDto(share))
    sharesByBill.set(share.bill_id, list)
  }
  const result: BillDto[] = bills.results.map((bill) => ({
    id: bill.id,
    homeId: bill.home_id,
    title: bill.title,
    totalCents: bill.total_cents,
    shares: sharesByBill.get(bill.id) ?? [],
  }))
  return c.json({ bills: result })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c)
  const title = readText(body, 'title')
  const totalCents = readTotalCents(body)
  await requireHome(c.env.DB, homeId)

  const billId = crypto.randomUUID()

  // Both statements run in ONE transaction (D1 batch): the bill and all its shares exist
  // together or not at all. The split is done in SQL, from the members as they are right now:
  //   share = total / n   (whole division)
  //   +1 for the first (total % n) members, in the order they were added.
  // So the shares always add up to total, and a member added in parallel cannot be missed.
  const [insertBill] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO bills (id, home_id, title, total_cents)
       SELECT ?1, ?2, ?3, ?4
       WHERE EXISTS (SELECT 1 FROM members WHERE home_id = ?2)`,
    ).bind(billId, homeId, title, totalCents),
    c.env.DB.prepare(
      `INSERT INTO shares (id, bill_id, member_id, amount_cents)
       SELECT lower(hex(randomblob(16))), ?1, m.id,
              CAST(?2 AS INTEGER) / m.n + CASE WHEN m.rn <= CAST(?2 AS INTEGER) % m.n THEN 1 ELSE 0 END
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY seq) AS rn, COUNT(*) OVER () AS n
         FROM members WHERE home_id = ?3
       ) AS m
       WHERE EXISTS (SELECT 1 FROM bills WHERE id = ?1)`,
    ).bind(billId, totalCents, homeId),
  ])
  if (!insertBill || insertBill.meta.changes === 0) {
    throw fail(422, 'Home has no members to split the bill between')
  }

  const shares = await loadShares(c.env.DB, billId)
  const bill: BillDto = { id: billId, homeId, title, totalCents, shares: shares.map(toShareDto) }
  return c.json(bill, 201)
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) throw fail(400, 'Idempotency-Key header is required')
  if (key.length > MAX_KEY_LENGTH) throw fail(400, 'Idempotency-Key is too long')

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  // The check "is it unpaid?" and the write are ONE statement. If two requests race,
  // the database lets only one of them change the row (changes === 1); the other gets 0.
  const update = await c.env.DB.prepare(
    `UPDATE shares SET paid_at = ?1, payment_key = ?2
     WHERE id = ?3 AND bill_id = ?4 AND paid_at IS NULL`,
  )
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()

  const share = await c.env.DB.prepare(
    `SELECT id, bill_id, member_id, amount_cents, paid_at, payment_key
     FROM shares WHERE id = ?1 AND bill_id = ?2`,
  )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!share) throw fail(404, 'Bill or share not found')

  // We paid it now, or an earlier request with the SAME key paid it: same answer, 200.
  if (update.meta.changes === 1 || share.payment_key === key) {
    return c.json(toShareDto(share), 200)
  }
  throw fail(409, 'Share was already paid with a different Idempotency-Key')
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const home = await requireHome(c.env.DB, c.req.param('homeId'))
  const rows = await c.env.DB.prepare(
    `SELECT m.id AS member_id, m.name AS name,
            COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents END), 0) AS outstanding_cents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ?1
     GROUP BY m.id, m.name, m.seq
     ORDER BY m.seq`,
  )
    .bind(home.id)
    .all<BalanceRow>()
  return c.json({
    balances: rows.results.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      outstandingCents: row.outstanding_cents,
    })),
  })
})

// Errors ---------------------------------------------------------------------------------
// Every error is JSON: { "error": "message" }. Unknown crashes are 500 with a safe message.

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
