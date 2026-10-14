import { Effect } from "effect"
import { For } from "./runtime/Controls.js"

export type { ForProps as Props } from "./runtime/Controls.js"

/**
 * Builds a keyed-repetition descriptor from props without JSX. Prefer
 * `<For.View>` in components.
 */
export const view = <A>(props: import("./runtime/Controls.js").ForProps<A>) => For(props)

/**
 * The keyed-repetition JSX tag. Reorders move retained keyed subtrees,
 * removals dispose their scopes, and replacing an item's object while
 * keeping its key remounts that row so snapshot props stay current.
 *
 * ```tsx
 * <For.View each={todos} keyOf={(todo) => todo.id}>
 *   {(todo) => <p>{todo.title}</p>}
 * </For.View>
 * ```
 */
export const View = Object.assign(view, {
  type: "component" as const,
  render: (props: never) => Effect.succeed(view(props))
})
