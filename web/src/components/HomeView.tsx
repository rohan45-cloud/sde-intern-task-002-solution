import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiRequestError,
  api,
  type Balance,
  type Bill,
  type Home,
  isAbort,
  messageOf,
} from '../api'
import { formatCents, parseDollarsToCents } from '../money'
import { BillCard } from './BillCard'

type HomeData = { home: Home; bills: Bill[]; balances: Balance[] }

async function loadAll(homeId: string, signal?: AbortSignal): Promise<HomeData> {
  const [home, bills, balances] = await Promise.all([
    api.getHome(homeId, signal),
    api.listBills(homeId, signal),
    api.getBalances(homeId, signal),
  ])
  return { home, bills: bills.bills, balances: balances.balances }
}

type Props = { homeId: string; onRetry: () => void; onLeave: () => void }

export function HomeView({ homeId, onRetry, onLeave }: Props) {
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  // Payment state, per share.
  const [paying, setPaying] = useState<ReadonlySet<string>>(new Set())
  const [payErrors, setPayErrors] = useState<Readonly<Record<string, string>>>({})
  // One Idempotency-Key per share. We keep it after an uncertain failure (timeout, 5xx), so a retry
  // is the SAME payment request and cannot pay twice.
  const keys = useRef(new Map<string, string>())

  useEffect(() => {
    const controller = new AbortController()
    loadAll(homeId, controller.signal)
      .then((loaded) => {
        setData(loaded)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setLoadError(messageOf(error))
        setLoading(false)
      })
    return () => controller.abort()
  }, [homeId])

  // Reloads after a change. It does not replace the page with a spinner.
  const refresh = useCallback(async () => {
    try {
      setData(await loadAll(homeId))
      setRefreshError(null)
    } catch (error) {
      setRefreshError(`Could not refresh: ${messageOf(error)}`)
    }
  }, [homeId])

  const payShare = useCallback(
    async (billId: string, shareId: string) => {
      const key = keys.current.get(shareId) ?? crypto.randomUUID()
      keys.current.set(shareId, key)
      setPaying((current) => new Set(current).add(shareId))
      setPayErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== shareId)),
      )
      try {
        const paid = await api.payShare(billId, shareId, key)
        keys.current.delete(shareId)
        // Only now, after the server said OK, does the share show as paid.
        setData((current) =>
          current
            ? {
                ...current,
                bills: current.bills.map((bill) =>
                  bill.id === billId
                    ? {
                        ...bill,
                        shares: bill.shares.map((share) =>
                          share.id === shareId ? { ...share, paidAt: paid.paidAt } : share,
                        ),
                      }
                    : bill,
                ),
              }
            : current,
        )
        await refresh()
      } catch (error) {
        const uncertain = error instanceof ApiRequestError && error.isUncertain
        if (!uncertain) keys.current.delete(shareId)
        setPayErrors((current) => ({ ...current, [shareId]: messageOf(error) }))
        if (error instanceof ApiRequestError && error.status === 409) await refresh()
      } finally {
        setPaying((current) => {
          const next = new Set(current)
          next.delete(shareId)
          return next
        })
      }
    },
    [refresh],
  )

  if (loading) {
    return (
      <p className="state" role="status">
        Loading home…
      </p>
    )
  }

  if (loadError || !data) {
    return (
      <div className="state state-error" role="alert">
        <p>{loadError ?? 'Could not load this home.'}</p>
        <div className="row">
          <button type="button" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="ghost" onClick={onLeave}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const memberNames = new Map(data.home.members.map((member) => [member.id, member.name]))

  return (
    <div className="stack">
      <header className="home-head">
        <div>
          <p className="eyebrow">Home</p>
          <h1>{data.home.name}</h1>
          <p className="muted">
            Home ID <code>{data.home.id}</code>
          </p>
        </div>
        <button type="button" className="ghost" onClick={onLeave}>
          Switch home
        </button>
      </header>

      {refreshError && (
        <p className="notice" role="alert">
          {refreshError}{' '}
          <button type="button" className="link" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}

      <section className="card">
        <h2>Members</h2>
        {data.home.members.length === 0 ? (
          <p className="muted">No members yet. Add at least one before adding a bill.</p>
        ) : (
          <ol className="members">
            {data.home.members.map((member) => (
              <li key={member.id}>{member.name}</li>
            ))}
          </ol>
        )}
        <AddMemberForm homeId={homeId} onAdded={refresh} />
      </section>

      <section className="card">
        <h2>Who owes what</h2>
        {data.balances.length === 0 ? (
          <p className="muted">Balances appear once the home has members.</p>
        ) : (
          <ul className="balances">
            {data.balances.map((balance) => (
              <li key={balance.memberId}>
                <span>{balance.name}</span>
                <span className="amount">{formatCents(balance.outstandingCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Add a bill</h2>
        <AddBillForm homeId={homeId} hasMembers={data.home.members.length > 0} onAdded={refresh} />
      </section>

      <section className="stack">
        <h2>Bills</h2>
        {data.bills.length === 0 ? (
          <p className="state">No bills yet. Add the first one above.</p>
        ) : (
          data.bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              memberNames={memberNames}
              paying={paying}
              payErrors={payErrors}
              onPay={(shareId) => void payShare(bill.id, shareId)}
            />
          ))
        )}
      </section>
    </div>
  )
}

function AddMemberForm({ homeId, onAdded }: { homeId: string; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.addMember(homeId, name)
      setName('')
      await onAdded()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="row" onSubmit={submit}>
      <label className="grow">
        <span className="sr-only">Member name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Member name"
          maxLength={100}
          required
        />
      </label>
      <button type="submit" disabled={busy || name.trim() === ''}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function AddBillForm({
  homeId,
  hasMembers,
  onAdded,
}: {
  homeId: string
  hasMembers: boolean
  onAdded: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const totalCents = parseDollarsToCents(amount)
    if (totalCents === null) {
      setError('Enter an amount above zero with at most 2 decimals, like 120.50')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createBill(homeId, title, totalCents)
      setTitle('')
      setAmount('')
      await onAdded()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!hasMembers) {
    return <p className="muted">Add a member first. A bill is split between the members.</p>
  }

  return (
    <form className="row" onSubmit={submit}>
      <label className="grow">
        <span className="sr-only">Bill title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title, e.g. Electricity"
          maxLength={100}
          required
        />
      </label>
      <label>
        <span className="sr-only">Amount in dollars</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount, e.g. 120.50"
          inputMode="decimal"
          required
        />
      </label>
      <button type="submit" disabled={busy || title.trim() === ''}>
        {busy ? 'Adding…' : 'Add bill'}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
