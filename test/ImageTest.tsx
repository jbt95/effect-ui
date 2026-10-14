import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import { defineComponent, Image, mount } from "../src/Legacy.js"
import { DeferredPromise } from "./DeferredPromise.js"

describe("Image", () => {
  it.each(["success", "failure"] as const)(
    "preserves the native image target for delayed decode %s callbacks",
    async (Outcome) => {
      const Decode = DeferredPromise()
      const Callback = vi.fn()
      const Errors: Array<unknown> = []
      const Container = document.createElement("div")

      const App = defineComponent(() => (
        <Image
          src="/delayed.webp"
          alt="Diagram"
          width={320}
          height={180}
          decode
          onLoad={(EventValue) => {
            EventValue.returnValue = false
            EventValue.cancelBubble = true
            EventValue.preventDefault()
            Callback("success", EventValue.currentTarget, EventValue.type, EventValue.target)
          }}
          onError={(EventValue) => {
            EventValue.returnValue = false
            EventValue.cancelBubble = true
            EventValue.preventDefault()
            Callback("failure", EventValue.currentTarget, EventValue.type, EventValue.target)
          }}
        />
      ))

      const Handle = mount(App, Container, Layer.empty, { onError: (Error) => Errors.push(Error) })
      const ImageElement = Container.querySelector("img")!
      const LoadEvent = new Event("load", { cancelable: true })
      // Model WebIDL setters: they must be invoked on the actual native event, not a proxy.
      Object.defineProperties(LoadEvent, {
        returnValue: {
          configurable: true,
          set(Value: boolean) {
            if (this !== LoadEvent) throw new TypeError("Invalid Event receiver")

            if (!Value) LoadEvent.preventDefault()
          }
        },
        cancelBubble: {
          configurable: true,
          set(Value: boolean) {
            if (this !== LoadEvent) throw new TypeError("Invalid Event receiver")

            if (Value) LoadEvent.stopPropagation()
          }
        }
      })
      ImageElement.decode = vi.fn(() => Decode.promise)
      ImageElement.dispatchEvent(LoadEvent)
      // Happy DOM does not always clear this field; model the native post-dispatch value.
      Object.defineProperty(LoadEvent, "currentTarget", { configurable: true, value: null })

      try {
        expect(Callback).not.toHaveBeenCalled()

        if (Outcome === "success") Decode.resolve()
        else Decode.reject(new Error("decode failed"))

        await vi.waitFor(() => expect(Callback).toHaveBeenCalledOnce())
        expect(Callback).toHaveBeenCalledWith(Outcome, ImageElement, "load", ImageElement)
        expect(LoadEvent.defaultPrevented).toBe(true)
        expect(Errors).toEqual([])
      } finally {
        await Handle.dispose()
      }
    }
  )

  it("renders native loading hints and reserves required intrinsic dimensions", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() => (
      <Image src="/hero.webp" alt="A mountain at sunrise" width={640} height={360} />
    ))

    const handle = mount(App, container, Layer.empty)
    const image = container.querySelector("img")

    expect(image?.getAttribute("src")).toBe("/hero.webp")
    expect(image?.alt).toBe("A mountain at sunrise")
    expect(image?.width).toBe(640)
    expect(image?.height).toBe(360)
    expect(image?.loading).toBe("lazy")

    await handle.dispose()
  })

  it("replaces a failed image with accessible default fallback content", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() => (
      <Image src="/missing.webp" alt="A red kite" width={160} height={90} />
    ))

    const handle = mount(App, container, Layer.empty)

    container.querySelector("img")?.dispatchEvent(new Event("error"))

    await vi.waitFor(() => expect(container.querySelector("img")).toBeNull())
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Image unavailable: A red kite"
    )

    await handle.dispose()
  })

  it("uses supplied fallback and runs native error callbacks", async () => {
    const onError = vi.fn()
    const container = document.createElement("div")

    const App = defineComponent(() => (
      <Image
        src="/missing.webp"
        alt="Profile photo"
        width={64}
        height={64}
        fallback={<span class="image-fallback">Profile unavailable</span>}
        onError={(event) => onError(event.currentTarget)}
      />
    ))

    const handle = mount(App, container, Layer.empty)
    const image = container.querySelector("img")

    image?.dispatchEvent(new Event("error"))

    await vi.waitFor(() => expect(container.textContent).toBe("Profile unavailable"))
    expect(onError).toHaveBeenCalledWith(image)

    await handle.dispose()
  })

  it("waits for decode when requested and treats decode failures as image errors", async () => {
    const onError = vi.fn()
    const container = document.createElement("div")

    const App = defineComponent(() => (
      <Image
        src="/broken-decode.webp"
        alt="Diagram"
        width={320}
        height={180}
        decode
        fallback={<p>Diagram unavailable</p>}
        onError={onError}
      />
    ))

    const handle = mount(App, container, Layer.empty)
    const image = container.querySelector("img")

    if (image === null) throw new Error("Image was not rendered")

    image.decode = vi.fn(() => Promise.reject(new Error("decode failed")))
    image.dispatchEvent(new Event("load"))

    await vi.waitFor(() => expect(container.textContent).toBe("Diagram unavailable"))
    expect(onError).toHaveBeenCalledOnce()

    await handle.dispose()
  })

  it("exposes preload as a lazy Effect operation", () => {
    const Preload = Image.preload("/banner.webp", { decode: false, fetchPriority: "high" })

    expect(Effect.isEffect(Preload)).toBe(true)
  })
})
