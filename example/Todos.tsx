import { Component, For, Signal } from "@effect/ui"
import { Context, Effect, Layer } from "effect"

interface Todo {
  readonly id: number
  readonly title: string
  readonly done: boolean
}

/**
 * Todos state lives in a service. Actions are closed effects (`Effect<void>`
 * with no service requirement), so they drop straight into `onClick`.
 */
class Todos extends Context.Service<
  Todos,
  {
    readonly items: Signal.Source<ReadonlyArray<Todo>>
    readonly add: Effect.Effect<void>
    readonly toggle: (id: number) => Effect.Effect<void>
    readonly remove: (id: number) => Effect.Effect<void>
  }
>()("Todos") {
  static readonly layer = Layer.effect(
    Todos,
    Effect.gen(function* () {
      let next = 3

      const items = yield* Signal.make<ReadonlyArray<Todo>>([
        { id: 1, title: "Build @effect/ui", done: false },
        { id: 2, title: "Ship the POC", done: true }
      ])

      const add = items.update((list) => {
        const id = next
        next += 1

        return [...list, { id, title: `New task ${id}`, done: false }]
      })

      const toggle = (id: number): Effect.Effect<void> =>
        items.update((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))

      const remove = (id: number): Effect.Effect<void> =>
        items.update((list) => list.filter((t) => t.id !== id))

      return Todos.of({ items, add, toggle, remove })
    })
  )
}

// A nested, props-driven component. It reads the shared `items` signal and
// derives just its own row reactively — `Signal.map` here is owned by this
// component's scope and cleaned up when the row is removed.
const TodoRow = Component.make(
  Effect.gen(function* () {
    const todos = yield* Todos

    return (props: {
      readonly id: number
      readonly onToggle: (id: number) => Effect.Effect<void>
      readonly onRemove: (id: number) => Effect.Effect<void>
    }) =>
      Effect.gen(function* () {
        const item = yield* Signal.map<ReadonlyArray<Todo>, Todo | undefined>(todos.items, (list) =>
          list.find((t) => t.id === props.id)
        )

        const title = yield* Signal.map<Todo | undefined, string>(item, (todo) => todo?.title ?? "")

        const rowClass = yield* Signal.map<Todo | undefined, string>(item, (todo) =>
          todo?.done ? "done" : ""
        )

        return (
          <li class={rowClass}>
            <span>{title}</span>
            <button onClick={props.onToggle(props.id)}>toggle</button>
            <button onClick={props.onRemove(props.id)}>remove</button>
          </li>
        )
      })
  })
)

const TodosView = Component.make(
  Effect.gen(function* () {
    const todos = yield* Todos
    const Row = yield* TodoRow

    return () =>
      Effect.gen(function* () {
        const remaining = yield* Signal.map(
          todos.items,
          (list) => list.filter((t) => !t.done).length
        )

        return (
          <section>
            <h2>Todos</h2>
            <button onClick={todos.add}>Add task</button>
            <p>Remaining: {remaining}</p>
            <ul>
              <For.View each={todos.items} keyOf={(t: Todo) => t.id}>
                {(todo: Todo) => (
                  <Row id={todo.id} onToggle={todos.toggle} onRemove={todos.remove} />
                )}
              </For.View>
            </ul>
          </section>
        )
      })
  })
)

export { Todos, TodoRow, TodosView }

export type { Todo }
