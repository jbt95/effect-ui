import { Effect } from "effect"

/**
 * Captures an Effect's environment now and returns the closed Effect. It
 * does not run the action. Use it during component acquisition or
 * application assembly, before an Effect enters a DOM event prop,
 * `Async.View`, or a route loader — those positions only accept closed
 * Effects.
 *
 * ```ts
 * const save = yield* Action.bind(Users.use((users) => users.save()))
 * const goHome = yield* Action.bind(Navigation.navigate("/"))
 * ```
 */
export const bind = Effect.fnUntraced(function* <A, E, R>(action: Effect.Effect<A, E, R>) {
  const context = yield* Effect.context<R>()

  return Effect.provideContext(action, context)
})
