import { describe, expect, it, vi } from "vitest"
import { createReactiveUpdateBinding } from "../src/runtime/Scheduler.js"

describe("reactive update scheduler", () => {
  it("coalesces rapid writes to the latest value in one microtask", async () => {
    const updates: Array<number> = []

    const errors: Array<unknown> = []

    const binding = createReactiveUpdateBinding(
      (value: number) => updates.push(value),
      (error) => errors.push(error)
    )

    for (let value = 1; value <= 10_000; value += 1) binding.schedule(value)

    expect(updates).toEqual([])
    await vi.waitFor(() => expect(updates).toEqual([10_000]))
    expect(errors).toEqual([])

    binding.dispose()
  })

  it("defers re-entrant writes to another flush and cancels disposed work", async () => {
    const updates: Array<number> = []
    let binding: ReturnType<typeof createReactiveUpdateBinding<number>>
    binding = createReactiveUpdateBinding(
      (value: number) => {
        updates.push(value)

        if (value === 1) binding.schedule(2)
      },
      () => {}
    )

    binding.schedule(1)
    await vi.waitFor(() => expect(updates).toEqual([1, 2]))

    binding.schedule(3)
    binding.dispose()
    await Promise.resolve()
    expect(updates).toEqual([1, 2])
  })

  it("reports a failed update without blocking other bindings", async () => {
    const errors: Array<unknown> = []

    const failure = new Error("binding failed")

    const broken = createReactiveUpdateBinding(
      () => {
        throw failure
      },
      (error) => errors.push(error)
    )

    const healthyUpdates: Array<string> = []

    const healthy = createReactiveUpdateBinding(
      (value: string) => healthyUpdates.push(value),
      (error) => errors.push(error)
    )

    broken.schedule(1)
    healthy.schedule("still updated")

    await vi.waitFor(() => {
      expect(errors).toEqual([failure])
      expect(healthyUpdates).toEqual(["still updated"])
    })

    broken.dispose()
    healthy.dispose()
  })
})
