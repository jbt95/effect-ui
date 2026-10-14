import { Effect } from "effect"
import type { Element, ElementProps } from "../Element.js"

export type ComponentRender<P extends object, E, R> = (props: P) => Effect.Effect<Element, E, R>

export type SynchronousComponentRender<P extends object> = (props: P) => Element

export interface LegacyComponent<in out P extends object, out E = never, out R = never> {
  (props: P): Element
  readonly type: "component"
  readonly render: ComponentRender<P, E, R>
}

export function defineComponent<P extends object = ElementProps>(
  render: SynchronousComponentRender<P>
): LegacyComponent<P>
export function defineComponent<P extends object = ElementProps, E = never, R = never>(
  render: ComponentRender<P, E, R>
): LegacyComponent<P, E, R>
export function defineComponent<P extends object = ElementProps, E = never, R = never>(
  render: SynchronousComponentRender<P> | ComponentRender<P, E, R>
): LegacyComponent<P, E, R> {
  let component: LegacyComponent<P, E, R>

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
