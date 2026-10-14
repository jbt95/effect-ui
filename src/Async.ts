import { Cause, Effect, Option, Stream } from "effect"
import { Control } from "./Control.js"
import { jsx, type Element, type ElementChild } from "./Element.js"
import type { Resource, ResourceState } from "./Resource.js"
import { fromSource } from "./Signal.js"
import { mountAsync } from "./runtime/Async.js"

export interface Options<A, E> {
  readonly success: (value: A) => ElementChild
  readonly pending?: ElementChild
  readonly failure?: (cause: Cause.Cause<E>) => ElementChild
}

export interface Props<A, E> extends Options<A, E> {
  readonly source: Resource<A, E> | Effect.Effect<A, E>
}

const mapResource = <A, E>(
  resource: Resource<A, E>,
  render: (value: A) => ElementChild
): Resource<ElementChild, E> => {
  let cached: { readonly value: A; readonly child: ElementChild } | undefined

  const success = (value: A): ElementChild => {
    if (cached === undefined || !Object.is(cached.value, value))
      cached = { value, child: render(value) }

    return cached.child
  }

  const state = (value: ResourceState<A, E>): ResourceState<ElementChild, E> =>
    value.status === "success"
      ? { status: "success", value: success(value.value) }
      : { ...value, previous: Option.map(value.previous, success) }

  const changes = resource.changes.pipe(Stream.map(state))

  return {
    state: fromSource({
      get: Effect.map(resource.state.get, state),
      get value() {
        return state(resource.state.value)
      },
      changes
    }),
    changes,
    refresh: resource.refresh,
    cancel: resource.cancel
  }
}

/** Pure descriptor adapter: loading Effects must already have their service requirements bound. */
export const view = <A, E>(source: Props<A, E>["source"], options: Options<A, E>): Element => {
  const control = Control.make<{}>("control/async/data", (_props, parent, host, anchor) => {
    const shared = { fallback: options.pending, failure: options.failure }

    return Effect.isEffect(source)
      ? mountAsync({ ...shared, effect: Effect.map(source, options.success) }, parent, host, anchor)
      : mountAsync(
          { ...shared, resource: mapResource(source, options.success) },
          parent,
          host,
          anchor
        )
  })

  return jsx(control, {})
}

const createView = <A, E>(props: Props<A, E>): Element => view(props.source, props)

export const View = Object.assign(createView, {
  type: "component" as const,
  render: (props: never) => Effect.succeed(createView(props))
})
