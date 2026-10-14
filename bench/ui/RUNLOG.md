# Run log (benchmark-driven development)

Each entry: one change, measured verdict vs the previous baseline. Full runs
use defaults (`bun run bench`); fast-loop runs note their env overrides.
`compare.ts` output pasted per entry. Reverted changes stay listed.

## 001 — static subtree fast path (Renderer.ts)

Fully static intrinsic elements and fragments render without `combine`
disposer trees and dispose as `noop`; signals, events, refs, components and
controls take the unchanged path. Same `applyAttrValue` calls, same DOM.

- old suite → new suite (different harness/day/seed, same browser/host/workload):
  10k create 36.8 → 18.6, append 40.95 → 20.7, update 9.6 → 5.25,
  clear 42.55 → 21.15, throughput 12.9/s → 22.4/s (~−50% / +74%).
  swap flat (27.15 → 25.9), delete +0.25ms abs (monitor).
- Verdict: KEEP. New baseline: first `bench/ui` run (seed 12345).

## 002 — LIS move diff for list reorder (Controls.ts, pending)

`reorderForEntries` walked all entries doing a DOM `nextSibling` read per
row on every commit. Now each entry tracks its last committed position;
commits compute one longest strictly-increasing run over old positions
(patience sorting, array-only) and move only the rest, guarded by a final
placement check. Fully ordered commits do zero DOM reads.

- Measured (seed 12345, n=24/case, same browser/host as 001 baseline):
  swap 1k 1.10 → 0.20 (−82%), swap 10k 25.9 → 1.30 (−95%), both rounds.
  Everything else within overlapping distributions / thermal drift
  (the untouched static-mount path drifted too); delete 10k +0.25ms abs and
  clear 10k +7% are watchlisted for the next A/B.
- Verdict: KEEP. Swap theory (cascade elimination) confirmed empirically.

## 003 — marker-free list entries (Controls.ts)

Each `For` item carried two comment sentinels (20k extra nodes at 10k
rows). Entries are now tracked by first/last node references with null for
empty renders; create/replace discover ranges from stable neighbors, and
removal/move helpers operate on inclusive ranges. Control-level sentinels
stay. Measured vs the LIS run (seed 12345, n=24/case, same browser/host):
create 1k −22% / 10k −19%, append −20% / −18%, clear −42% / −23%,
throughput +7–9% — all round-consistent with whole-distribution shifts.
Swap/update/delete flat; static-mount/dispose noise (n=2, untouched path,
11× within-run spread in baseline too).

- Verdict: KEEP.

## 003 — marker-free list entries (Controls.ts)

Each `For` item carried two comment sentinels (20k extra nodes at 10k
rows: extra inserts, removals, moves, observer records, retained memory).
Entries are now tracked by first/last node references with null for empty
renders; create/replace discover ranges from stable neighbors, and
removal/move helpers operate on inclusive ranges. Control-level sentinels
stay. The reorder insertBefore assertion moved 6 → 2 for the same reversal.

- Verdict: KEEP (measured above: create −19–22%, clear −23–42%, throughput +7–9%).

## 004 — fused commit planning (Controls.ts, pending)

Each commit built four O(n) structures (Prepared objects, Desired, Seen,
Removed tuples via Array.from+filter) across separate passes. Key
validation, staging and removal collection now share one pass over the
input plus one map pass: keys array (dup-check still throws before any DOM
work), direct Desired staging, removals collected as entries with inline
map deletion. Target: the per-commit floor on every op (delete/swap first).

- Verdict: PENDING — awaiting fast-loop A/B vs baseline.

## 005 — ordered pre-scan skips LIS and DOM walk (Controls.ts, pending)

Fully ordered commits still paid LIS tables, a Set, lookups and order
rewrites. A pure array pre-scan now detects strictly increasing committed
positions (any new entry fails it) and skips everything, read-only. Swap,
restores and initial mounts fall through to LIS unchanged.
Target: delete/update floors.

- Verdict: PENDING — awaiting fast-loop A/B vs baseline. Note: this stacks
  on unmeasured 004; on regression, bisect 004 vs 005 via their commits.

## 004b — static workload repetitions (harness, measurement-only)

Static mount/dispose ran once per round (n=2, 11× within-run spread),
making it unjudgeable. Now `BENCH_STATIC_REPS=3` per scale and round
(n=6). No library code touched; keyed/throughput/signal cases unaffected.
Takes effect in the same run as the 004 A/B.
