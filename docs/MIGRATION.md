# Migration and compatibility policy

`@effect/ui` is pre-1.0 and has not published a stable compatibility contract.
Breaking API and behavior changes may occur between 0.x releases. The README
and this guide describe the current development API, not a guarantee that a
particular 0.x version can be upgraded without code changes.

Before 1.0, migrations should follow this sequence:

1. Read the release notes and update the lockfile with the intended version.
2. Run `bun run typecheck`, `bun run typecheck:package`, `bun run test`, and the
   real-browser smoke test on supported engines.
3. Replace deprecated router `fallback` with `notFound`.
4. Replace catch-all or untyped intrinsic props with the current element-specific
   JSX props; use native event callback types and explicit refs.
5. Re-test disposal paths for async loaders, route changes, form submission,
   and error-boundary reset.

The 1.0 policy is to use semantic versioning after a published 1.0.0 release:
breaking public API changes require a major release, additive compatible APIs a
minor release, and compatible fixes a patch release. The 0.x phase does not
receive that guarantee. SSR and hydration remain a separate product decision
and are not implied by the 1.0 browser-runtime policy.
