/**
 * Effect-native component lifecycle.
 *
 * - `Lifecycle.onMount(action)` runs an Effect after the instance's DOM is
 *   inserted, with the registering context bound.
 * - `Lifecycle.onCleanup(action)` registers a scoped finalizer; its expected
 *   error channel must be `never`.
 *
 * Both accept Effects, never callbacks — returning an Effect from a plain
 * callback does not register anything.
 */
export { Service, mounted as onMount, cleanup as onCleanup } from "./runtime/Lifecycle.js"
