interface QueuedUpdate {
  readonly flush: () => void
  readonly reportError: (error: unknown) => void
}

export interface ReactiveUpdateBinding<A> {
  readonly schedule: (value: A) => void
  readonly dispose: () => void
}

const QueuedUpdates = new Set<QueuedUpdate>()

let FlushQueued = false

const flushUpdates = (): void => {
  FlushQueued = false
  const Updates = Array.from(QueuedUpdates)
  QueuedUpdates.clear()

  for (const Update of Updates) {
    try {
      Update.flush()
    } catch (error) {
      Update.reportError(error)
    }
  }

  if (QueuedUpdates.size > 0) queueUpdateFlush()
}

const queueUpdateFlush = (): void => {
  if (FlushQueued) return

  FlushQueued = true
  queueMicrotask(flushUpdates)
}

/** Coalesces each reactive binding to its latest value for the next microtask. */
export const createReactiveUpdateBinding = <A>(
  update: (value: A) => void,
  reportError: (error: unknown) => void
): ReactiveUpdateBinding<A> => {
  let PendingValue: A
  let HasPendingValue = false
  let Disposed = false

  const QueuedUpdate: QueuedUpdate = {
    flush: () => {
      if (Disposed || !HasPendingValue) return

      const Value = PendingValue
      HasPendingValue = false
      update(Value)
    },
    reportError
  }

  return {
    schedule: (value) => {
      if (Disposed) return

      PendingValue = value
      HasPendingValue = true
      QueuedUpdates.add(QueuedUpdate)
      queueUpdateFlush()
    },
    dispose: () => {
      Disposed = true
      HasPendingValue = false
      QueuedUpdates.delete(QueuedUpdate)
    }
  }
}
