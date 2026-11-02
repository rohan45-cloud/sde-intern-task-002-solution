import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { HomeView } from '../components/HomeView'
import { StartView } from '../components/StartView'

type HomeSearch = { home?: string }

export const Route = createFileRoute('/')({
  // The selected home lives in the URL (?home=ID), so a refresh keeps the page.
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    typeof search.home === 'string' && search.home !== '' ? { home: search.home } : {},
  component: Page,
})

function Page() {
  const { home } = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  // Changing this key remounts HomeView, which is how "Try again" reloads everything.
  const [attempt, setAttempt] = useState(0)

  return (
    <main className="page">
      {home ? (
        <HomeView
          key={`${home}:${attempt}`}
          homeId={home}
          onRetry={() => setAttempt((value) => value + 1)}
          onLeave={() => void navigate({ search: {} })}
        />
      ) : (
        <StartView onOpen={(id) => void navigate({ search: { home: id } })} />
      )}
    </main>
  )
}
