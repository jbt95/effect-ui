import { Effect } from "effect"
import { For } from "./runtime/Controls.js"

export type { ForProps as Props } from "./runtime/Controls.js"

export const view = <A>(props: import("./runtime/Controls.js").ForProps<A>) => For(props)

export const View = Object.assign(view, {
  type: "component" as const,
  render: (props: never) => Effect.succeed(view(props))
})
