import { createReactiveUpdateBinding } from "../src/runtime/Scheduler.js"

const WriteCount = Number(process.env.BENCH_WRITES ?? 100_000)

const UpdateCount = Number(process.env.BENCH_BINDINGS ?? 1_000)

let AppliedValues = 0

let LastValue = -1

const Binding = createReactiveUpdateBinding(
  (value: number) => {
    AppliedValues += 1
    LastValue = value
  },
  (error) => {
    throw error
  }
)

const StartedAt = performance.now()

for (let value = 0; value < WriteCount; value += 1) Binding.schedule(value)

await new Promise<void>((resolve) => queueMicrotask(resolve))

const ElapsedMs = performance.now() - StartedAt

if (AppliedValues !== 1 || LastValue !== WriteCount - 1) {
  throw new Error(
    `Reactive scheduler regression: expected one latest-value update, got ${AppliedValues} / ${LastValue}`
  )
}

const Bindings: Array<ReturnType<typeof createReactiveUpdateBinding<number>>> = []

let FanoutUpdates = 0

for (let index = 0; index < UpdateCount; index += 1) {
  Bindings.push(
    createReactiveUpdateBinding(
      () => {
        FanoutUpdates += 1
      },
      (error) => {
        throw error
      }
    )
  )
}

const FanoutStartedAt = performance.now()

for (const [index, Update] of Bindings.entries()) Update.schedule(index)

await new Promise<void>((resolve) => queueMicrotask(resolve))

const FanoutElapsedMs = performance.now() - FanoutStartedAt

if (FanoutUpdates !== UpdateCount) {
  throw new Error(`Reactive scheduler regression: expected ${UpdateCount} fanout updates`)
}

for (const Update of Bindings) Update.dispose()

Binding.dispose()

console.log(
  JSON.stringify(
    {
      writes: WriteCount,
      coalescedUpdates: AppliedValues,
      coalescedElapsedMs: Number(ElapsedMs.toFixed(3)),
      fanoutBindings: UpdateCount,
      fanoutUpdates: FanoutUpdates,
      fanoutElapsedMs: Number(FanoutElapsedMs.toFixed(3))
    },
    null,
    2
  )
)
