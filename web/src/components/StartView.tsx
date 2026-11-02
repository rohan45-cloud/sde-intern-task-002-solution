import { type SyntheticEvent, useState } from 'react'
import { api, messageOf } from '../api'

export function StartView({ onOpen }: { onOpen: (homeId: string) => void }) {
  const [name, setName] = useState('')
  const [existingId, setExistingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const home = await api.createHome(name)
      onOpen(home.id)
    } catch (caught) {
      setError(messageOf(caught))
      setBusy(false)
    }
  }

  function open(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = existingId.trim()
    if (id) onOpen(id)
  }

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Shared home</p>
        <h1>Bill splitter</h1>
        <p className="muted">Split a bill between housemates. Everyone pays their own share.</p>
      </header>

      <section className="card">
        <h2>Create a home</h2>
        <form className="row" onSubmit={create}>
          <label className="grow">
            <span className="sr-only">Home name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Home name, e.g. Flat 4B"
              maxLength={100}
              required
            />
          </label>
          <button type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Creating…' : 'Create home'}
          </button>
        </form>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Open an existing home</h2>
        <form className="row" onSubmit={open}>
          <label className="grow">
            <span className="sr-only">Home ID</span>
            <input
              value={existingId}
              onChange={(event) => setExistingId(event.target.value)}
              placeholder="Home ID"
            />
          </label>
          <button type="submit" className="ghost" disabled={existingId.trim() === ''}>
            Open
          </button>
        </form>
      </section>
    </div>
  )
}
