import type { Effect, Scope } from "effect"
import type { ElementChild } from "./Element.js"
import type { Service as LifecycleService } from "./runtime/Lifecycle.js"

/**
 * An explicitly assembled UI program. `R` names the application services the
 * assembly requires; `E` names assembly-time failures. Ordinary JSX
 * descriptors do not preserve a tree-wide environment, so dependency
 * acquisition happens in `assemble` (yielding `Component.make` factories)
 * and the result is plain, dependency-closed JSX.
 *
 * ```ts
 * const App = Application.make<Users>()(Effect.gen(function* () {
 *   const ProfileView = yield* Profile
 *   return <ProfileView id="ada" />
 * }))
 * ```
 */
export interface Application<E = never, R = never> {
  readonly assemble: Effect.Effect<ElementChild, E, R | Scope.Scope | LifecycleService>
}

/**
 * Declares the application's service contract. There is no whole-tree
 * dependency inference: acquire every dependency-bearing factory inside
 * `assemble`, then compose the closed tags. Adding an undeclared dependency
 * fails compilation; supplying an incomplete `Layer` at startup fails at the
 * typed mount interface.
 */
export const make =
  <R = never>() =>
  <E>(
    assemble: Effect.Effect<ElementChild, E, R | Scope.Scope | LifecycleService>
  ): Application<E, R> => ({ assemble })

export { scoped as mount, start, layer } from "./Mount.js"
