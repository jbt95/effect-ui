export interface BrowserSnapshot {
  readonly href: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

type BrowserSyncTarget = (snapshot: BrowserSnapshot) => void

const targets = new Set<BrowserSyncTarget>()

export const registerBrowserSync = (target: BrowserSyncTarget): (() => void) => {
  targets.add(target)

  return () => {
    targets.delete(target)
  }
}

export const syncBrowserSnapshots = (snapshot: BrowserSnapshot): void => {
  for (const target of Array.from(targets)) {
    try {
      target(snapshot)
    } catch {
      // A single stale provider must not break navigation.
    }
  }
}

export const deferBrowserSync = (snapshot: BrowserSnapshot): void => {
  queueMicrotask(() => syncBrowserSnapshots(snapshot))
}

export const snapshotFromHref = (href: string): BrowserSnapshot => {
  const url = new URL(href)

  return { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash }
}

export const snapshotFromWindow = (): BrowserSnapshot => snapshotFromHref(window.location.href)

export const isBrowserSnapshot = (href: string): boolean => {
  try {
    return new URL(href).origin === window.location.origin
  } catch {
    return false
  }
}
