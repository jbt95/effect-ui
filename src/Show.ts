import { Show } from "./runtime/Controls.js"

export type { ShowProps as Props } from "./runtime/Controls.js"

export const View = Show

export const view = (props: import("./runtime/Controls.js").ShowProps) => View(props)
