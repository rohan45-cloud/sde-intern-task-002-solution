export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

const REQUEST_TIMEOUT_MS = 10_000

// Every failure becomes one of these, with a message that is safe to show to a person.
export class ApiRequestError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }

  // true when we do not know if the server did the work (timeout, network, 5xx).
  get isUncertain(): boolean {
    return this.status === null || this.status >= 500
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

function readErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const message = (data as { error: unknown }).error
    if (typeof message === 'string' && message) return message
  }
  return `Request failed (${status})`
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // A slow API must not hang the page forever: give up after a timeout.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error // the caller cancelled: let it handle that
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiRequestError('The server took too long to answer. Please try again.', null)
    }
    throw new ApiRequestError('Could not reach the server. Check your connection.', null)
  }

  // The body may be empty or not JSON (e.g. a proxy error page). Never let that crash us.
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new ApiRequestError(readErrorMessage(data, response.status), response.status)
  }
  if (data === null) {
    throw new ApiRequestError('The server sent an unreadable answer.', response.status)
  }
  return data as T
}

export const api = {
  createHome: (name: string) =>
    request<{ id: string; name: string }>('/api/homes', { method: 'POST', body: { name } }),
  getHome: (homeId: string, signal?: AbortSignal) =>
    request<Home>(`/api/homes/${encodeURIComponent(homeId)}`, { signal }),
  addMember: (homeId: string, name: string) =>
    request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: { name },
    }),
  listBills: (homeId: string, signal?: AbortSignal) =>
    request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`, { signal }),
  createBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: { title, totalCents },
    }),
  getBalances: (homeId: string, signal?: AbortSignal) =>
    request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(homeId)}/balances`, {
      signal,
    }),
  payShare: (billId: string, shareId: string, idempotencyKey: string) =>
    request<Share>(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    ),
}
