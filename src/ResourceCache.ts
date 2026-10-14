import { Clock, Context, Duration, Effect, Exit, Layer, Scope, Semaphore } from "effect"
import { Resource, type Resource as ResourceValue } from "./Resource.js"

interface ResourceCacheEntry<A, E> {
  readonly resource: ResourceValue<A, E>
  readonly remove: () => void
  readonly lastCheckedAt: number | undefined
}

interface CacheEntryHandle {
  readonly resource: { readonly cancel: Effect.Effect<void> }
  readonly remove: () => void
}

interface CacheIdentity {
  readonly owner: true
}

const EntriesKey: unique symbol = Symbol.for("@effect/ui/ResourceCache/entries")

/**
 * A typed, parameterized query definition. Inert until invoked: calling it
 * produces an Effect requiring the owning `Cache` plus the loader's services.
 * `identify` must return a stable string per argument; entries are shared by
 * their serialized id. Loader and identity stay referentially stable, so keys
 * can live at module scope.
 */
export interface ResourceCacheKey<Args, A, E, R> {
  (args: Args): Effect.Effect<ResourceValue<A, E>, never, Cache | R>
  readonly id: string
  readonly identify: (args: Args) => string
  readonly load: (args: Args) => Effect.Effect<A, E, R>
  readonly staleTimeMillis: number
  readonly [EntriesKey]: WeakMap<CacheIdentity, Map<string, ResourceCacheEntry<A, E>>>
}

/**
 * The cache capability. Provide it with `ResourceCache.layer` for an
 * application-wide cache, or build a local one with `ResourceCache.make`.
 * Entries are owned by the cache's scope until invalidated, cleared, or torn
 * down — removing one consumer never cancels shared work.
 */
export class Cache extends Context.Service<Cache, ResourceCache>()("@effect/ui/ResourceCache") {}

/** Arguments for `ResourceCache.key`: identity, loader, and stale time. */
export interface KeyOptions<Args, A, E, R> {
  readonly identify: (args: Args) => string
  readonly load: (args: Args) => Effect.Effect<A, E, R>
  readonly staleTime?: Duration.Input
}

/**
 * A scope-owned keyed cache. `get` shares in-flight work between identical
 * query/argument pairs and revalidates stale entries; `invalidate` and
 * `clear` remove entries and cancel their active loads.
 */
export interface ResourceCache {
  /** Returns a cached resource, sharing in-flight work and refreshing stale entries. */
  readonly get: <Args, A, E, R>(
    key: ResourceCacheKey<Args, A, E, R>,
    args: Args
  ) => Effect.Effect<ResourceValue<A, E>, never, R>
  /** Removes and interrupts one cached entry. */
  readonly invalidate: <Args, A, E, R>(
    key: ResourceCacheKey<Args, A, E, R>,
    args: Args
  ) => Effect.Effect<void>
  /** Removes and interrupts all entries owned by this cache. */
  readonly clear: Effect.Effect<void>
}

const EntryId = <Args, A, E, R>(Key: ResourceCacheKey<Args, A, E, R>, ArgsValue: Args): string =>
  JSON.stringify([Key.id, Key.identify(ArgsValue)])

const getEntries = <Args, A, E, R>(
  Key: ResourceCacheKey<Args, A, E, R>,
  CacheId: CacheIdentity
): Map<string, ResourceCacheEntry<A, E>> => {
  const Existing = Key[EntriesKey].get(CacheId)

  if (Existing !== undefined) return Existing

  const Created = new Map<string, ResourceCacheEntry<A, E>>()
  Key[EntriesKey].set(CacheId, Created)

  return Created
}

const trackLoad = <A, E, R>(
  Load: Effect.Effect<A, E, R>,
  OnChecked: (At: number) => void
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const Result = yield* Effect.exit(Load)

    OnChecked(yield* Clock.currentTimeMillis)

    if (Exit.isSuccess(Result)) return Result.value

    return yield* Effect.failCause(Result.cause)
  })

const shouldRefresh = <A, E>(
  Entry: ResourceCacheEntry<A, E>,
  Now: number,
  StaleTime: number
): boolean => {
  const State = Entry.resource.state.value

  if (State.status === "pending") return false

  if (State.status === "cancelled") return true

  return Entry.lastCheckedAt === undefined || Now - Entry.lastCheckedAt >= StaleTime
}

const reuseEntry = <A, E>(
  Entry: ResourceCacheEntry<A, E>,
  StaleTime: number
): Effect.Effect<ResourceValue<A, E>> =>
  Effect.gen(function* () {
    const State = Entry.resource.state.value

    if (State.status === "pending") return Entry.resource

    const Now = yield* Clock.currentTimeMillis

    if (shouldRefresh(Entry, Now, StaleTime)) yield* Entry.resource.refresh

    return Entry.resource
  })

const makeEntry = <Args, A, E, R>(
  Key: ResourceCacheKey<Args, A, E, R>,
  ArgsValue: Args,
  Entries: Map<string, ResourceCacheEntry<A, E>>,
  Records: Set<CacheEntryHandle>,
  CacheScope: Scope.Scope,
  EntryKey: string
): Effect.Effect<ResourceValue<A, E>, never, R> =>
  Effect.gen(function* () {
    let LastCheckedAt: number | undefined
    const Load = trackLoad(Key.load(ArgsValue), (At) => (LastCheckedAt = At))
    const ResourceValue = yield* Scope.provide(CacheScope)(Resource.make(Load))

    let Entry: ResourceCacheEntry<A, E>

    const Remove = (): void => {
      Entries.delete(EntryKey)
      Records.delete(Entry)
    }

    Entry = {
      resource: ResourceValue,
      remove: Remove,
      get lastCheckedAt() {
        return LastCheckedAt
      }
    }

    Entries.set(EntryKey, Entry)
    Records.add(Entry)

    return ResourceValue
  })

const getResource = <Args, A, E, R>(
  Key: ResourceCacheKey<Args, A, E, R>,
  ArgsValue: Args,
  CacheScope: Scope.Scope,
  CacheId: CacheIdentity,
  Records: Set<CacheEntryHandle>,
  Lock: Semaphore.Semaphore
): Effect.Effect<ResourceValue<A, E>, never, R> =>
  Lock.withPermit(
    Effect.gen(function* () {
      const Entries = getEntries(Key, CacheId)
      const KeyValue = EntryId(Key, ArgsValue)
      const Existing = Entries.get(KeyValue)

      if (Existing !== undefined) return yield* reuseEntry(Existing, Key.staleTimeMillis)

      return yield* makeEntry(Key, ArgsValue, Entries, Records, CacheScope, KeyValue)
    })
  )

const invalidateResource = <Args, A, E, R>(
  Key: ResourceCacheKey<Args, A, E, R>,
  ArgsValue: Args,
  CacheId: CacheIdentity,
  Lock: Semaphore.Semaphore
): Effect.Effect<void> =>
  Lock.withPermit(
    Effect.gen(function* () {
      const Entries = Key[EntriesKey].get(CacheId)

      if (Entries === undefined) return

      const Entry = Entries.get(EntryId(Key, ArgsValue))

      if (Entry === undefined) return

      Entry.remove()
      yield* Entry.resource.cancel
    })
  )

const clearResources = (
  Records: Set<CacheEntryHandle>,
  Lock: Semaphore.Semaphore
): Effect.Effect<void> =>
  Lock.withPermit(
    Effect.gen(function* () {
      for (const Entry of Array.from(Records)) {
        Entry.remove()
        yield* Entry.resource.cancel
      }
    })
  )

const releaseEntries = (Records: Set<CacheEntryHandle>): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const Entry of Array.from(Records)) Entry.remove()
  })

const makeKey = <Args, A, E, R>(
  Id: string,
  Identify: (args: Args) => string,
  Load: (args: Args) => Effect.Effect<A, E, R>,
  StaleTime: Duration.Input = "0 millis"
): ResourceCacheKey<Args, A, E, R> => {
  const KeyId = Id.trim()
  const StaleTimeMillis = Duration.toMillis(StaleTime)

  if (KeyId.length === 0) throw new TypeError("[@effect/ui] resource cache key id cannot be empty")

  if (Number.isNaN(StaleTimeMillis) || StaleTimeMillis < 0) {
    throw new RangeError("[@effect/ui] resource cache stale time must not be negative")
  }

  let Key: ResourceCacheKey<Args, A, E, R>
  Key = Object.assign((args: Args) => Cache.use((cache) => cache.get(Key, args)), {
    id: KeyId,
    identify: Identify,
    load: Load,
    staleTimeMillis: StaleTimeMillis,
    [EntriesKey]: new WeakMap<CacheIdentity, Map<string, ResourceCacheEntry<A, E>>>()
  })

  return Key
}

/**
 * Creates a scope-owned cache with no service wiring. Prefer `layer` for
 * application code; use `make` for explicitly local caches whose lifetime you
 * manage. Note `get` still requires the loaders' services — close those with
 * `Action.bind` before using a local cache inside a renderer.
 */
export const make = Effect.fnUntraced(function* (): Effect.fn.Return<
  ResourceCache,
  never,
  Scope.Scope
> {
  const CacheScope = yield* Effect.scope
  const CacheId: CacheIdentity = { owner: true }
  const Lock = yield* Semaphore.make(1)
  const Records = new Set<CacheEntryHandle>()

  yield* Scope.addFinalizer(CacheScope, releaseEntries(Records))

  const get = <Args, A, E, R>(
    Key: ResourceCacheKey<Args, A, E, R>,
    ArgsValue: Args
  ): Effect.Effect<ResourceValue<A, E>, never, R> =>
    getResource(Key, ArgsValue, CacheScope, CacheId, Records, Lock)

  const invalidate = <Args, A, E, R>(
    Key: ResourceCacheKey<Args, A, E, R>,
    ArgsValue: Args
  ): Effect.Effect<void> => invalidateResource(Key, ArgsValue, CacheId, Lock)

  const clear = clearResources(Records, Lock)

  return { get, invalidate, clear }
})

/**
 * Defines an inert, callable query. Invoking the key does not run the loader
 * — it returns an Effect requiring `Cache` plus the loader's services.
 *
 * ```ts
 * const UserQuery = ResourceCache.key("user", {
 *   identify: (id: string) => id,
 *   load: (id) => Users.use((users) => users.get(id)),
 *   staleTime: "5 minutes"
 * })
 * ```
 */
export function key<Args, A, E, R>(
  id: string,
  options: KeyOptions<Args, A, E, R>
): ResourceCacheKey<Args, A, E, R>
/** @deprecated Use key(id, { identify, load, staleTime }). */
export function key<Args, A, E, R>(
  id: string,
  identify: (args: Args) => string,
  load: (args: Args) => Effect.Effect<A, E, R>,
  staleTime?: Duration.Input
): ResourceCacheKey<Args, A, E, R>
export function key<Args, A, E, R>(
  id: string,
  options: KeyOptions<Args, A, E, R> | ((args: Args) => string),
  load?: (args: Args) => Effect.Effect<A, E, R>,
  staleTime?: Duration.Input
): ResourceCacheKey<Args, A, E, R> {
  if (isOptions(options)) return makeKey(id, options.identify, options.load, options.staleTime)

  if (load === undefined) throw new TypeError("[@effect/ui] a query requires a loader")

  return makeKey(id, options, load, staleTime)
}

const isOptions = <Args, A, E, R>(
  options: KeyOptions<Args, A, E, R> | ((args: Args) => string)
): options is KeyOptions<Args, A, E, R> => typeof options !== "function"

/** Provides a scope-owned `Cache` service. Never a global cache. */
export const layer = Layer.effect(Cache, make())

/** Looks a query up in the ambient `Cache`, sharing in-flight and fresh entries. */
export const get = <Args, A, E, R>(query: ResourceCacheKey<Args, A, E, R>, args: Args) =>
  query(args)

/** Removes one entry from the ambient `Cache`, cancelling its active load. */
export const invalidate = <Args, A, E, R>(query: ResourceCacheKey<Args, A, E, R>, args: Args) =>
  Cache.use((cache) => cache.invalidate(query, args))

/** Removes every entry owned by the ambient `Cache`, cancelling active loads. */
export const clear = Cache.use((cache) => cache.clear)

/**
 * Captures the ambient `Cache` and the loader's requirements now, returning a
 * closed `(args) => Effect<Resource>` safe to invoke inside instance
 * renderers, event handlers, and route loaders. Bind during component
 * acquisition or application assembly.
 */
export const bind = Effect.fnUntraced(function* <Args, A, E, R>(
  query: ResourceCacheKey<Args, A, E, R>
) {
  const cache = yield* Cache
  const context = yield* Effect.context<R>()

  return (args: Args) => Effect.provideContext(cache.get(query, args), context)
})

/** Scoped keyed caching with shared in-flight work and revalidation. See `key` and `layer`. */
export const ResourceCache = { make, key, Cache, layer, get, invalidate, clear, bind }
