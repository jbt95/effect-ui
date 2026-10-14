# Release checklist

The package is intentionally private and versioned `0.0.0` during pre-1.0
development. The workflow in `.github/workflows/release.yml` is inert until an
owner publishes a GitHub Release, and it stops if the package still has
`"private": true` or the release tag differs from `v<package version>`.

Before the first public release:

1. Add the canonical GitHub repository and issue tracker URLs to `package.json`.
2. Confirm the MIT copyright holder and year in `LICENSE`.
3. Configure npm trusted publishing for this GitHub repository and the
   `Publish package` workflow. The workflow uses GitHub OIDC and npm provenance;
   no long-lived npm token is stored in GitHub Secrets.
4. Review the lockfile, README, API/migration docs, supported-browser matrix, and
   run the real-browser smoke test for each supported engine.
5. Set the intended package version, remove `"private": true` only with explicit
   release approval, and publish a GitHub Release tagged exactly
   `v<package version>`.

After 1.0.0, follow semantic versioning: breaking public API changes require a
major release, compatible additive APIs a minor release, and compatible fixes a
patch release. The pre-1.0 compatibility policy is documented in
[`MIGRATION.md`](MIGRATION.md).
