import type { Effect, Scope } from "effect"
import type { ElementChild } from "./Element.js"
import type { Service as LifecycleService } from "./runtime/Lifecycle.js"

/** Explicit assembly contract. Dependency-bearing factories are acquired before entering JSX. */
export interface Application<E = never, R = never> {
  readonly assemble: Effect.Effect<ElementChild, E, R | Scope.Scope | LifecycleService>
}

export const make =
  <R = never>() =>
  <E>(
    assemble: Effect.Effect<ElementChild, E, R | Scope.Scope | LifecycleService>
  ): Application<E, R> => ({ assemble })

export { scoped as mount, start, layer } from "./Mount.js"
