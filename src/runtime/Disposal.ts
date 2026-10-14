import { combine, type Disposer, type Host } from "../Control.js"

export const disposeAfterFailure = (
  error: unknown,
  disposers: ReadonlyArray<Disposer>,
  host: Host
): never => {
  void combine(disposers)().catch((cleanupError) => {
    host.reportError(
      new AggregateError([error, cleanupError], "Rendering failed and cleanup also failed")
    )
  })
  throw error
}
