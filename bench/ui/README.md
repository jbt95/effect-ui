# @effect/ui benchmark (single-framework, hillclimb loop)

Measures this codebase's critical paths in a real Chromium browser. No
cross-framework comparison: one framework, repeated browser measurements, raw
samples with median/p95. Built for benchmark-driven development — each
optimization is accepted or reverted based on measured deltas.

## Commands

From this directory, in your own terminal (browser automation cannot run from
a sandboxed session):

```bash
bun install
bun run test        # correctness only (happy-dom + pure units), no browser needed
bun run build       # typechecks, builds the production app, records source hash
bun run serve       # terminal 1, keep open (http://127.0.0.1:4173)
bun run bench       # terminal 2, full run
bun run scripts/compare.ts results/<baseline>.json results/<candidate>.json
```

Fast iteration loop (~1-2 minutes):

```bash
BENCH_ROWS=10000 BENCH_RUNS=10 BENCH_ROUNDS=1 BENCH_WARMUPS=2 BENCH_BOOT_RUNS=1 bun run bench
```

Smoke (correctness of a fresh change, ~30 seconds):

```bash
BENCH_ROWS=1000 BENCH_RUNS=3 BENCH_ROUNDS=1 BENCH_WARMUPS=1 BENCH_BOOT_RUNS=1 BENCH_DURATION_MS=200 bun run bench
```

## Controls

| Variable                | Default             | Meaning                                                     |
| ----------------------- | ------------------- | ----------------------------------------------------------- |
| `BENCH_RUNS`            | 12                  | Measured samples per keyed case and signal case             |
| `BENCH_ROUNDS`          | 2                   | Repeated randomized scale blocks                            |
| `BENCH_WARMUPS`         | 3                   | Discarded samples before each keyed case                    |
| `BENCH_BOOT_RUNS`       | 2                   | Mount samples per scale (after a discarded navigation)      |
| `BENCH_ROWS`            | `100,1000,10000`    | Table/signal scales                                         |
| `BENCH_DURATION_MS`     | 1000                | Sustained-throughput window per scale and round             |
| `BENCH_STATIC_REPS`     | 3                   | Static mount/dispose repetitions per scale and round        |
| `BENCH_SEED`            | 12345               | Fixed seed: same order every run, required for hillclimbing |
| `BENCH_RESULTS_DIR`     | `results/`          | Output directory                                            |
| `BENCH_EXECUTABLE_PATH` | Playwright Chromium | Compatible browser override                                 |
| `BENCH_HEADED`          | `1` to show         | Headed mode (never mix with headless in a comparison)       |

## Workloads (critical paths)

- **keyed**: create/append/update-every-10th/swap/delete/clear at each scale.
  Guards list reconciliation: planning, disposal, reorder, verification.
- **static**: mount and dispose a fully static table. Guards the static fast
  path and disposal cost with no reactive overhead.
- **signals**: update N signal-bound cells. Guards fine-grained binding
  fan-out, the library's core claim.
- **throughput**: sustained verified update toggles per second at each scale.
- **mount**: cold navigation + first render per scale.

Timing starts before state writes and ends at the last observed DOM mutation
of a subsequently verified visible DOM (revision marker + row order + actual
cell text). Verification and observer scheduling perturb the workload; these
are DOM-completion proxies, not bare renderer CPU times.

## Hillclimb protocol

1. `bun run build && bun run bench` on the base commit; keep the timestamped
   JSON as `baseline.json` (copy it out of `results/`).
2. Implement ONE change. `bun run test && bun run build` must pass; the build
   refuses to measure stale sources (source hash vs `dist/meta.json`).
3. Run the fast loop, then `compare.ts baseline.json results/bench-latest.json`.
4. Keep the change only on consistent round-level wins: target medians improve
   ≥5% in every round with no other case regressing ≥5%. Otherwise revert.
5. Record the verdict (change, deltas, seed, browser version) in the run log.
6. If a run combines multiple unmeasured changes and regresses, bisect with
   `git log --oneline`, rebuilding and re-running at each candidate commit.

`results/` is gitignored. Do not compare across browsers, headed/headless
modes, machines, or seeds. One full `bun run bench` with defaults before
declaring victory.
