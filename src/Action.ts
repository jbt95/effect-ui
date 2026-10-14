import { Effect } from "effect"

/** Bind an Effect's requirements during setup, before it enters a DOM event or async view. */
export const bind = Effect.fnUntraced(function* <A, E, R>(action: Effect.Effect<A, E, R>) {
  const context = yield* Effect.context<R>()

  return Effect.provideContext(action, context)
})
