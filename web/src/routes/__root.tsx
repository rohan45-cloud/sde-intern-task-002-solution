import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Component, type ErrorInfo, type ReactNode } from 'react'

// Last safety net: if rendering ever throws, show a message instead of a blank page.
class CrashGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="page">
          <div className="state state-error" role="alert">
            <p>Something went wrong on this page.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

export const Route = createRootRoute({
  component: () => (
    <CrashGuard>
      <Outlet />
    </CrashGuard>
  ),
})
