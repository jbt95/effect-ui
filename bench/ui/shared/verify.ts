import type { Row } from "./workloads.js"
import { matchesRows } from "./workloads.js"

export interface DomCompletion {
  readonly observedAt: number
  readonly readinessChecks: number
}

// A revision marker is only a hint: independently scheduled list work can
// outlive it. Observe mutations, then check visible contents and order in a
// task after microtasks. Report the last observed mutation timestamp, not the
// later verification time.
export const waitForDom = (
  root: HTMLElement,
  rows: ReadonlyArray<Row>,
  revision: number,
  timeoutMs = 30_000
): { readonly done: Promise<DomCompletion>; readonly cancel: (error: Error) => void } => {
  let resolve!: (result: DomCompletion) => void
  let reject!: (error: Error) => void
  const done = new Promise<DomCompletion>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  const channel = new MessageChannel()
  let queued = false
  let finished = false
  let observedAt = performance.now()
  let readinessChecks = 0

  const cleanup = (): void => {
    finished = true
    observer.disconnect()
    clearTimeout(timeout)
    channel.port1.close()
    channel.port2.close()
  }
  const cancel = (cause: Error): void => {
    if (finished) return
    cleanup()
    reject(cause)
  }
  const queue = (): void => {
    if (queued || finished) return
    queued = true
    channel.port2.postMessage(null)
  }
  const observer = new MutationObserver(() => {
    observedAt = performance.now()
    queue()
  })
  const timeout = setTimeout(
    () =>
      cancel(new Error(`DOM did not reach revision ${revision} with ${rows.length} verified rows`)),
    timeoutMs
  )
  channel.port1.onmessage = () => {
    queued = false
    if (finished) return
    readinessChecks += 1
    if (root.dataset.revision !== String(revision) || !matchesRows(root, rows)) return
    cleanup()
    resolve({ observedAt, readinessChecks })
  }
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })

  return { done, cancel }
}

export const waitForCount = (
  root: HTMLElement,
  selector: string,
  count: number,
  timeoutMs = 30_000
): Promise<number> => {
  const startedAt = performance.now()

  return new Promise<number>((resolve, reject) => {
    const check = (): void => {
      if (root.querySelectorAll(selector).length === count) {
        resolve(performance.now() - startedAt)

        return
      }

      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${count} nodes matching ${selector}`))

        return
      }

      setTimeout(check, 0)
    }

    check()
  })
}
