import type { RouteDefinition } from "./router/Types.js"

type WithoutPath<A> = A extends { readonly path: string } ? Omit<A, "path"> : never

export type Options = WithoutPath<RouteDefinition>

/** Pure route declaration; acquire services before constructing loader closures. */
export const make = (path: string, options: Options): RouteDefinition => ({ ...options, path })
