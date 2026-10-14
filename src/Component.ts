import { Effect } from "effect"
import type { Element, ElementProps } from "./Element.js"

/**
 * The render function of a component: maps props to an `Effect` that consumes
 * services and returns a JSX element. Reusable + traceable via `Effect.fn`.
 */
export type ComponentRender<P extends object, E, R> = (props: P) => Effect.Effect<Element, E, R>

export type SynchronousComponentRender<P extends object> = (props: P) => Element

/**
 * A component. Used as a JSX tag: `<MyComp {...props} />`. Services flow from
 * the root runtime; the render effect runs once on mount (fine-grained
 * reactivity lives in the `Signal`s it places into the tree).
 */
export interface Component<in out P extends object, out E = never, out R = never> {
  (props: P): Element
  readonly type: "component"
  readonly render: ComponentRender<P, E, R>
}

/** Define a component from either a JSX value or an Effect-producing renderer. */
export function defineComponent<P extends object = ElementProps>(
  render: SynchronousComponentRender<P>
): Component<P>
export function defineComponent<P extends object = ElementProps, E = never, R = never>(
  render: ComponentRender<P, E, R>
): Component<P, E, R>
export function defineComponent<P extends object = ElementProps, E = never, R = never>(
  render: SynchronousComponentRender<P> | ComponentRender<P, E, R>
): Component<P, E, R> {
  let component: Component<P, E, R>

  const asElement = (props: P): Element => ({
    type: component,
    props: Object.fromEntries(Object.entries(props)),
    children: []
  })

  const renderEffect: ComponentRender<P, E, R> = (props) => {
    const result = render(props)

    return Effect.isEffect(result) ? result : Effect.succeed(result)
  }

  component = Object.assign(asElement, { type: "component" as const, render: renderEffect })

  return component
}

/** Namespace-style alias for projects that prefer `Component.make(...)`. */
export const Component = {
  make: defineComponent
}

/** Type guard distinguishing components from intrinsic tags / control tags. */
export const isComponent = (u: unknown): u is Component<ElementProps, unknown, unknown> =>
  typeof u === "function" && "type" in u && u.type === "component"
