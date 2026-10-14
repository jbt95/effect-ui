# Release checklist

The package is intentionally private and versioned `0.0.0` during pre-1.0
development. The workflow in `.github/workflows/release.yml` is inert until an
owner publishes a GitHub Release, and it stops if the package still has
`"private": true` or the release tag differs from `v<package version>`.

Before the first public release:

1. Add the canonical GitHub repository and issue tracker URLs to `package.json`.
2. Confirm the MIT copyright holder and year in `LICENSE`.
3. Confirm access to the `@effect` npm scope and whether `@effect/ui` already
   exists. A new package may require an owner-authorized initial publish before
   its npm package settings are available for trusted publisher configuration.
   Configure GitHub Actions trusted publishing with the exact workflow filename
   `release.yml` (not the display name), and enable direct `npm publish` in the
   allowed actions. The workflow uses GitHub OIDC and npm provenance; no
   long-lived npm token is stored in GitHub Secrets. It runs Node.js 24; npm
   trusted publishing requires npm 11.5.1+ and Node.js 22.14.0+.
4. Review the lockfile, README, API/migration docs, supported-browser matrix, and
   run `bun run ci` and `bun run bench:runtime`. CI includes `bun run test:package`,
   which packs and imports every public ESM entry point, then typechecks the
   extracted declarations in an isolated NodeNext consumer without source aliases
   or `skipLibCheck`. Run the real-browser smoke test for each supported engine.
5. Set the intended package version, remove `"private": true` only with explicit
   release approval, and publish a GitHub Release tagged exactly
   `v<package version>`.

The workflow also rejects `0.0.0` and missing repository/issue metadata. The
repository URL must match the GitHub repository publishing the release. Tags
containing a prerelease suffix (for example, `v0.1.0-beta.1`) publish to npm's
`next` dist-tag; stable versions publish to `latest`. This prevents a preview
release from replacing the normal installation target.

After 1.0.0, follow semantic versioning: breaking public API changes require a
major release, compatible additive APIs a minor release, and compatible fixes a
patch release. The pre-1.0 compatibility policy is documented in
[`MIGRATION.md`](MIGRATION.md).
