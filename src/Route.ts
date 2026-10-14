import type { RouteDefinition } from "./router/Types.js"

type WithoutPath<A> = A extends { readonly path: string } ? Omit<A, "path"> : never

/** Route table entries without the `path`, which `Route.make` supplies. */
export type Options = WithoutPath<RouteDefinition>

/**
 * Declares a pure route table entry. Acquire services before constructing
 * loader closures so the returned definition stays a plain value.
 */
export const make = (path: string, options: Options): RouteDefinition => ({ ...options, path })
