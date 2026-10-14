import { Deferred, Effect, Layer, Stream } from "effect"
import { describe, expect, it, vi } from "vitest"
import { defineComponent } from "../src/component/Legacy.js"
import { createForm, Form } from "../src/Form.js"
import { Signal } from "../src/Signal.js"
import { mount } from "../src/runtime/Mount.js"

describe("Effect-aware forms", () => {
  it("stores validation issues and skips submit until the form is valid", async () => {
    let submitted = ""

    const form = await Effect.runPromise(
      createForm({
        initial: { email: "" },
        validate: (values) =>
          Effect.succeed(values.email.includes("@") ? [] : ["Enter a valid email"]),
        onSubmit: (values) =>
          Effect.sync(() => {
            submitted = values.email
          })
      })
    )

    await Effect.runPromise(form.submit)
    expect(form.errors.value).toEqual(["Enter a valid email"])
    expect(submitted).toBe("")
    expect(form.submitting.value).toBe(false)

    await Effect.runPromise(form.values.set({ email: "ada@example.com" }))
    await Effect.runPromise(form.submit)
    expect(form.errors.value).toEqual([])
    expect(submitted).toBe("ada@example.com")
    expect(form.submitting.value).toBe(false)

    await Effect.runPromise(form.reset)
    expect(form.values.value).toEqual({ email: "" })
    expect(form.errors.value).toEqual([])
  })

  it("preserves submission failures and clears the submitting state", async () => {
    const failure = new Error("save failed")

    const form = await Effect.runPromise(
      createForm({
        initial: "ready",
        validate: () => Effect.succeed([]),
        onSubmit: () => Effect.fail(failure)
      })
    )

    const exit = await Effect.runPromise(Effect.exit(form.submit))

    expect(exit._tag).toBe("Failure")
    expect(form.submitting.value).toBe(false)
  })

  it("binds a reactive field and preserves sibling values on updates", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const form = yield* createForm({
            initial: { email: "", name: "Ada" },
            validate: () => Effect.succeed([]),
            onSubmit: () => Effect.void
          })

          const email = yield* Form.field(form.values, "email")
          const ReachedEmail = yield* Deferred.make<void>()
          const ReachedUpdatedEmail = yield* Deferred.make<void>()

          yield* Signal.changes(email.value).pipe(
            Stream.runForEach((Value) => {
              if (Value === "ada@example.com") return Deferred.succeed(ReachedEmail, undefined)

              if (Value === "ada@example.com!") {
                return Deferred.succeed(ReachedUpdatedEmail, undefined)
              }

              return Effect.void
            }),
            Effect.forkScoped
          )

          yield* email.set("ada@example.com")
          yield* Deferred.await(ReachedEmail)
          yield* email.update((Value) => `${Value}!`)
          yield* Deferred.await(ReachedUpdatedEmail)

          expect(form.values.value).toEqual({ email: "ada@example.com!", name: "Ada" })
          expect(email.value.value).toBe("ada@example.com!")
        })
      )
    )
  })

  it("prevents native submission and runs the Effect form handler", async () => {
    let submitted = ""

    const formState = await Effect.runPromise(
      createForm({
        initial: "ready",
        validate: () => Effect.succeed([]),
        onSubmit: (values) =>
          Effect.sync(() => {
            submitted = values
          })
      })
    )

    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <form onSubmit={formState.onSubmit}>
          <button type="submit">Save</button>
        </form>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const event = new SubmitEvent("submit", { bubbles: true, cancelable: true })
    container.querySelector("form")!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(submitted).toBe("ready"))
    await handle.dispose()
  })
})
