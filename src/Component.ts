import { Effect } from "effect"
import type { Scope } from "effect"
import type { Element, ElementProps } from "./Element.js"
import type { Service as LifecycleService } from "./runtime/Lifecycle.js"
import {
  defineComponent,
  type LegacyComponent,
  type SynchronousComponentRender
} from "./component/Legacy.js"

/**
 * The per-instance environment available to every component renderer: the
 * owning `Scope` (state, selectors, resources, forks, finalizers) plus the
 * instance `Lifecycle` service. Renderers must not require application
 * services — acquire those in `Component.make` before returning the renderer.
 */
export type Local = Scope.Scope | LifecycleService

/**
 * A component renderer: maps props to the instance tree. Runs once per
 * mount; fine-grained updates come from the `Signal`s placed in the tree,
 * never from re-running the renderer.
 */
export type Render<P extends object, E = never> = (props: P) => Effect.Effect<Element, E, Local>

/**
 * A JSX tag whose application dependencies have already been acquired.
 * Composing closed tags in JSX is always safe; the `Application` assembly
 * contract is where service requirements are checked.
 */
export type Component<P extends object = ElementProps, E = never> = LegacyComponent<P, E, Local>

/**
 * Declares a pure props-to-JSX tag. Does not execute the renderer; the
 * renderer runs once per mount with no instance requirements.
 */
export const sync = <P extends object = ElementProps>(
  render: SynchronousComponentRender<P>
): Component<P> => defineComponent(render)

/**
 * Declares a scoped component tag. The renderer runs once per mount with
 * only `Local` requirements; allocate instance state, resources, selectors,
 * and lifecycle actions inside it — never during factory acquisition, which
 * would share them across every mounted instance.
 */
export const local = <P extends object = ElementProps, E = never>(
  render: Render<P, E>
): Component<P, E> => defineComponent(render)

/**
 * Acquires application dependencies once and returns a closed JSX tag.
 * Service reads belong in `acquire`; props-dependent state belongs in the
 * returned renderer. Yield the resulting factory in `Application` assembly
 * before using its tag in JSX.
 *
 * ```ts
 * const Profile = Component.make(Effect.gen(function* () {
 *   const users = yield* Users
 *   return (props: { readonly id: string }) => Effect.gen(function* () {
 *     const user = yield* Resource.make(users.get(props.id))
 *     return <Async.View source={user} success={(value) => <h1>{value.name}</h1>} />
 *   })
 * }))
 * ```
 */
export const make = <P extends object, ERender, EAcquire, R>(
  acquire: Effect.Effect<Render<P, ERender>, EAcquire, R>
): Effect.Effect<Component<P, ERender>, EAcquire, R> => Effect.map(acquire, local)

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- JSX decoding is a runtime protocol guard.
/**
 * Type guard distinguishing component tags from intrinsic tags and controls.
 * Used by the renderer after JSX has checked the tag type.
 */
export const isComponent = (value: unknown): value is Component<ElementProps, unknown> =>
  typeof value === "function" && "type" in value && value.type === "component"
