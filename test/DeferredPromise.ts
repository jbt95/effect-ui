export const DeferredPromise = <A = void>() => {
  let Resolve!: (Value: A | PromiseLike<A>) => void
  let Reject!: (Reason: Error) => void

  const PromiseValue = new Promise<A>((ResolvePromise, RejectPromise) => {
    Resolve = ResolvePromise
    Reject = RejectPromise
  })

  return { promise: PromiseValue, resolve: Resolve, reject: Reject }
}
