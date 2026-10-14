import { Effect } from "effect"
import type { Scope } from "effect"
import type { Element, ElementProps } from "./Element.js"
import type { Service as LifecycleService } from "./runtime/Lifecycle.js"
import {
  defineComponent,
  type LegacyComponent,
  type SynchronousComponentRender
} from "./component/Legacy.js"

export type Local = Scope.Scope | LifecycleService

export type Render<P extends object, E = never> = (props: P) => Effect.Effect<Element, E, Local>

/** A JSX tag whose application dependencies have already been acquired. */
export type Component<P extends object = ElementProps, E = never> = LegacyComponent<P, E, Local>

/** Pure declaration; does not execute the renderer. */
export const sync = <P extends object = ElementProps>(
  render: SynchronousComponentRender<P>
): Component<P> => defineComponent(render)

/** Allocate instance state in this scoped renderer, never in factory acquisition. */
export const local = <P extends object = ElementProps, E = never>(
  render: Render<P, E>
): Component<P, E> => defineComponent(render)

/** Acquire dependencies before the returned tag enters JSX. */
export const make = <P extends object, ERender, EAcquire, R>(
  acquire: Effect.Effect<Render<P, ERender>, EAcquire, R>
): Effect.Effect<Component<P, ERender>, EAcquire, R> => Effect.map(acquire, local)

// oxlint-disable-next-line better-antislop/no-unknown-parameters -- JSX decoding is a runtime protocol guard.
export const isComponent = (value: unknown): value is Component<ElementProps, unknown> =>
  typeof value === "function" && "type" in value && value.type === "component"
