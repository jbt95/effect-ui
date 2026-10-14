import { ErrorBoundary } from "./runtime/ErrorBoundary.js"

export type { ErrorBoundaryProps as Props } from "./runtime/ErrorBoundary.js"

export const View = ErrorBoundary

export const view = (props: import("./runtime/ErrorBoundary.js").ErrorBoundaryProps) => View(props)
