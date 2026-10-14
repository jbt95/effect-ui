import { ErrorBoundary } from "./runtime/ErrorBoundary.js"

export type { ErrorBoundaryProps as Props } from "./runtime/ErrorBoundary.js"

/**
 * The error-boundary JSX tag. Catches descendant render, event Effect, and
 * reactive-update failures; the fallback builder receives the failure and a
 * `reset()` action that disposes and recreates the subtree. Not a security
 * or authorization boundary.
 *
 * ```tsx
 * <ErrorBoundary.View fallback={(cause, reset) => <button onClick={() => reset()}>
 *   {String(cause)}
 * </button>}>
 *   <Profile />
 * </ErrorBoundary.View>
 * ```
 */
export const View = ErrorBoundary

/**
 * Builds an error-boundary descriptor from props without JSX. Prefer
 * `<ErrorBoundary.View>` in components.
 */
export const view = (props: import("./runtime/ErrorBoundary.js").ErrorBoundaryProps) => View(props)
