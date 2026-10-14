# Browser Framework Production Roadmap

Scope: evolve `@effect/ui` into a production-ready browser application framework.
SSR and hydration are deliberately deferred until there is a separate product
decision; matching every feature of React, Angular, and Vue is not a bounded
goal. Breaking public API changes are acceptable before 1.0.

## 1. DOM and JSX foundations

- [x] Replace the catch-all intrinsic JSX map with element-specific HTML and SVG
      props; keep `data-*`, `aria-*`, and custom-element attributes extensible.
- [x] Add typed object and callback refs; set them on mount and clear them on
      disposal, including failed and dynamic mounts.
- [x] Add native-event-aware handlers while retaining closed Effect handlers;
      type each event by its DOM event and preserve error reporting/interruption.
- [x] Define and test DOM property/attribute serialization, boolean attributes,
      SVG attributes, and an explicit safe policy for raw HTML.

## 2. Runtime semantics

- [x] Add asynchronous component initialization with pending/fallback UI.
- [x] Add scoped error boundaries for render, event, and reactive-update failures.
- [x] Specify and test update scheduling, batching, re-entrancy, and disposal
      guarantees under rapid signal updates.
- [x] Add transitions and deferred updates without weakening deterministic
      cleanup or event interruption.

## 3. Forms and accessibility

- [x] Support controlled and uncontrolled form fields, reset, and composition
      events with typed values.
- [x] Add form validation/submission helpers that compose with Effect errors.
- [x] Audit keyboard, focus, semantics, and ARIA behavior; add focus management
      primitives and accessibility tests.

## 4. Routing and navigation

- [x] Add typed `Link`/navigation helpers with active state and accessibility
      behavior.
- [x] Add nested layouts and route-level pending, error, and not-found handling.
- [x] Add route loaders and cancellation tied to navigation and router disposal.
- [x] Add scroll restoration and navigation lifecycle hooks.

## 5. Production and ecosystem

- [x] Add a supported-browser matrix and a WebDriver real-browser integration
      test harness.
- [x] Add testing utilities for mounting, events, async updates, and cleanup.
- [x] Add performance benchmarks and guard against update/render regressions.
- [x] Publish API reference, migration guidance, accessibility/security guidance,
      and end-to-end application examples.
- [x] Add an MIT license, package metadata, sequential CI, guarded tag-based npm
      publishing, and a documented 1.0 compatibility policy.
- [ ] Set the canonical repository/issue URLs and intentionally make the package
      public only when the owner approves a release.

## Deferred product decision

- [ ] Revisit SSR, streaming, and hydration after the browser runtime has a
      stable 1.0 contract.

## High-impact browser framework roadmap

Prioritize the features with broad, measurable impact on data loading, startup,
large collections, and app navigation. Keep the core browser-first and bundler-
agnostic; offer specialized or build-time features as optional adapters.

- [x] Allow synchronous JSX component renderers; reserve Effect renderers for
      service access and scoped/effectful initialization.
- [x] Add an Effect-native `Resource` with pending/success/failure/cancelled
      states, refresh cancellation, and retention of the previous successful
      value while refreshing.
- [x] Add an app/runtime-scoped `ResourceCache`: stable keys, in-flight request
      deduplication, stale-time/revalidation, explicit invalidation, and safe
      cancellation. Do not use a process-global cache that leaks across mounts.
- [x] Add lazy route modules and route-level chunk loading, preserving layouts,
      pending/error UI, and cancellation. Follow with intent-based `Link`
      prefetch that deduplicates work and ignores modified/external clicks.
- [x] Add an image-loading primitive that uses native HTTP/browser caching,
      supports lazy loading, preload/decode, intrinsic dimensions, and accessible
      fallback/error handling. Avoid a competing opaque byte cache; keep build-
      time format/resizing optimization in optional bundler adapters.
- [x] Add memoized derived selectors for expensive computations, with explicit
      dependencies/equality and scope-aware disposal. Components build once, so
      prefer cached derivations over React-style component memoization.
- [x] Integrate Effect's browser HTTP client with request/response middleware,
      schema-based JSON decoding, injectable Fetch transport, and same-origin
      BFF URL rewriting. Compose query caching through `ResourceCache`, not a
      second global cache.
- [x] Add headless virtualized collection/table primitives for large datasets:
      stable row keys, overscan, row/column windowing, and accessible keyboard
      behavior. Keep generic virtualization separable from core UI primitives.
- [x] Add route-scoped document metadata (starting with title and description)
      with deterministic restoration when navigation or a router is disposed.

Next.js-inspired route chunks, prefetch, and revalidation; Astro-inspired image
delivery; and Vue-inspired computed caching are useful patterns, not a mandate
to copy their server or bundler architecture. Partial hydration and server-first
features remain deferred with SSR. File-based routes and build-time image
transforms should remain optional adapters unless a later product decision shows
they are worth imposing on all users.
