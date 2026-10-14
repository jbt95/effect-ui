import { Show } from "./runtime/Controls.js"

export type { ShowProps as Props } from "./runtime/Controls.js"

/**
 * The conditional-branch JSX tag. Mounts `children` while `when` holds and
 * the `fallback` otherwise, disposing the inactive branch.
 *
 * ```tsx
 * <Show.View when={visible} fallback={<p>Hidden</p>}>
 *   <p>Visible</p>
 * </Show.View>
 * ```
 */
export const View = Show

/**
 * Builds a conditional descriptor from props without JSX. Prefer
 * `<Show.View>` in components.
 */
export const view = (props: import("./runtime/Controls.js").ShowProps) => View(props)
