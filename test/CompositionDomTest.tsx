import { Effect, Layer } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  jsx,
  defineComponent,
  createRef,
  blur,
  focus,
  focusFirst,
  Async,
  ErrorBoundary,
  For,
  mount,
  onCleanup,
  onMount,
  Resource,
  Show,
  Signal,
  type StyleLike
} from "../src/Legacy.js"
import type { ClassValue } from "../src/Legacy.js"
import type { ElementChild } from "../src/Element.js"

describe("component composition and control flow", () => {
  it("supports direct JSX from synchronous component renderers", async () => {
    const Greeting = defineComponent((props: { readonly name: string }) => (
      <p>Hello, {props.name}!</p>
    ))

    const App = defineComponent(() => (
      <main>
        <Greeting name="Ada" />
      </main>
    ))

    const container = document.createElement("div")

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("Hello, Ada!")
    await handle.dispose()
  })

  it("composes nested components and binds reactive text and attributes", async () => {
    const count = Effect.runSync(Signal.make(0))
    const className = Effect.runSync(Signal.make("idle"))
    const style = Effect.runSync(Signal.make<StyleLike>({ color: "red" }))
    const container = document.createElement("div")
    let mountedText = ""
    let cleanupCount = 0
    let rootMounted = false

    const Label = defineComponent(
      (props: {
        readonly count: Signal<number>
        readonly className: Signal<string>
        readonly style: Signal<StyleLike>
      }) =>
        Effect.gen(function* () {
          const doubled = yield* Signal.map<number, number>(props.count, (value) => value * 2)
          yield* onMount(() => {
            mountedText = container.querySelector("p")?.textContent ?? ""
          })
          yield* onCleanup(() => {
            cleanupCount += 1
          })

          return (
            <p className={props.className} style={props.style}>
              count: {props.count} · double: {doubled}
            </p>
          )
        })
    )

    const App = defineComponent(() =>
      Effect.gen(function* () {
        const next = yield* Signal.map<number, number>(count, (value) => value + 1)
        yield* onMount(() => {
          rootMounted = container.querySelector("section") !== null
        })

        return (
          <section>
            <Label count={count} className={className} style={style} />
            <output>{next}</output>
          </section>
        )
      })
    )

    const handle = mount(App, container, Layer.empty)
    expect(container.textContent).toBe("count: 0 · double: 01")
    expect(mountedText).toBe("count: 0 · double: 0")
    expect(rootMounted).toBe(true)
    expect(container.querySelector("p")?.className).toBe("idle")
    expect(container.querySelector("p")?.style.color).toBe("red")

    await Effect.runPromise(count.set(3))
    await Effect.runPromise(className.set("active"))
    await Effect.runPromise(style.set({ backgroundColor: "blue" }))
    await vi.waitFor(() => {
      expect(container.textContent).toBe("count: 3 · double: 64")
      expect(container.querySelector("p")?.className).toBe("active")
      expect(container.querySelector("p")?.style.backgroundColor).toBe("blue")
      expect(container.querySelector("p")?.style.color).toBe("")
    })

    await handle.dispose()
    expect(cleanupCount).toBe(1)
    expect(container.textContent).toBe("")
  })

  it("batches rapid signal writes to the latest DOM value", async () => {
    const value = Effect.runSync(Signal.make("initial"))
    const container = document.createElement("div")
    const valueSetter = vi.spyOn(HTMLInputElement.prototype, "value", "set")
    let renderCount = 0

    const App = defineComponent(() => {
      renderCount += 1

      return Effect.succeed(
        <>
          <p>{value}</p>
          <input value={value} />
        </>
      )
    })

    const handle = mount(App, container, Layer.empty)

    await vi.waitFor(() => {
      expect(container.querySelector("p")?.textContent).toBe("initial")
      expect(container.querySelector("input")?.value).toBe("initial")
    })

    await vi.waitFor(() => expect(valueSetter).toHaveBeenCalled())
    valueSetter.mockClear()
    expect(renderCount).toBe(1)

    await Effect.runPromise(
      Effect.gen(function* () {
        for (let index = 0; index < 1000; index += 1) {
          yield* value.set(index === 999 ? "latest" : `value-${index}`)
        }
      })
    )

    await vi.waitFor(() => {
      expect(container.querySelector("p")?.textContent).toBe("latest")
      expect(container.querySelector("input")?.value).toBe("latest")
    })
    expect(valueSetter).toHaveBeenCalled()
    expect(valueSetter.mock.calls.length).toBeLessThan(1000)
    expect(renderCount).toBe(1)

    await handle.dispose()
    valueSetter.mockRestore()
  })

  it("attaches and clears typed refs across dynamic mounts and disposal", async () => {
    const visible = Effect.runSync(Signal.make(true))
    const buttonRef = createRef<HTMLButtonElement>()
    const callbackValues: Array<HTMLButtonElement | null> = []
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Show when={visible}>
          <button
            ref={(button) => {
              callbackValues.push(button)
            }}
          >
            Save
          </button>
          <button ref={buttonRef}>Cancel</button>
        </Show>
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(buttonRef.current?.textContent).toBe("Cancel")
    expect(callbackValues).toHaveLength(1)
    expect(callbackValues[0]?.textContent).toBe("Save")

    await Effect.runPromise(visible.set(false))
    await vi.waitFor(() => {
      expect(container.textContent).toBe("")
      expect(buttonRef.current).toBeNull()
      expect(callbackValues.at(-1)).toBeNull()
    })

    await Effect.runPromise(visible.set(true))
    await vi.waitFor(() => expect(buttonRef.current?.textContent).toBe("Cancel"))
    expect(callbackValues.at(-1)?.textContent).toBe("Save")

    await handle.dispose()
    expect(buttonRef.current).toBeNull()
    expect(callbackValues.at(-1)).toBeNull()
  })

  it("shows async fallback content and replaces it with the resolved subtree", async () => {
    let resolveContent!: (content: JSX.Element) => void

    const content = new Promise<JSX.Element>((resolve) => {
      resolveContent = resolve
    })

    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <Async effect={Effect.promise(() => content)} fallback={<p>Loading profile</p>} />
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toBe("Loading profile")
    resolveContent(<strong>Profile ready</strong>)
    await vi.waitFor(() => expect(container.textContent).toContain("Profile ready"))
    expect(container.querySelector("p")).toBeNull()

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("renders an Effect Resource through Async and retains its last value while refreshing", async () => {
    let resolveRefresh!: (content: ElementChild) => void
    let loads = 0

    const load = Effect.suspend(() => {
      loads += 1

      return loads === 1
        ? Effect.succeed(<strong>Profile ready</strong>)
        : Effect.promise(
            () =>
              new Promise<ElementChild>((resolve) => {
                resolveRefresh = resolve
              })
          )
    })

    const container = document.createElement("div")

    let refreshStarted: (() => void) | undefined

    const App = defineComponent(() =>
      Effect.gen(function* () {
        const resource = yield* Resource.make(load)

        return (
          <>
            <button
              onClick={() =>
                resource.refresh.pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      refreshStarted?.()
                    })
                  )
                )
              }
            >
              Refresh
            </button>
            <Async resource={resource} fallback={<p>Loading profile</p>} />
          </>
        )
      })
    )

    const handle = mount(App, container, Layer.empty)

    await vi.waitFor(() => expect(container.textContent).toContain("Profile ready"))

    const RefreshStarted = new Promise<void>((resolve) => {
      refreshStarted = resolve
    })

    container.querySelector("button")!.click()
    await RefreshStarted
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf("function"))
    await vi.waitFor(() => expect(container.textContent).toContain("Profile ready"))
    expect(container.textContent).not.toContain("Loading profile")
    resolveRefresh(<strong>Profile refreshed</strong>)
    await vi.waitFor(() => expect(container.textContent).toContain("Profile refreshed"))

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("renders an async failure view and interrupts pending initialization on disposal", async () => {
    const errors: Array<unknown> = []

    const failedContainer = document.createElement("div")

    const failure = new Error("profile unavailable")

    const FailedApp = defineComponent(() =>
      Effect.succeed(
        <Async
          effect={Effect.fail(failure)}
          fallback={<p>Loading</p>}
          error={(cause) => <p>Unable to load: {String(cause)}</p>}
        />
      )
    )

    const failedHandle = mount(FailedApp, failedContainer, Layer.empty, {
      onError: (error) => errors.push(error)
    })

    await vi.waitFor(() =>
      expect(failedContainer.textContent).toBe("Unable to load: Error: profile unavailable")
    )
    expect(errors).toEqual([])
    await failedHandle.dispose()

    let resolveContent!: (content: JSX.Element) => void

    const content = new Promise<JSX.Element>((resolve) => {
      resolveContent = resolve
    })

    const cancelledContainer = document.createElement("div")

    const PendingApp = defineComponent(() =>
      Effect.succeed(<Async effect={Effect.promise(() => content)} fallback={<p>Loading</p>} />)
    )

    const pendingHandle = mount(PendingApp, cancelledContainer, Layer.empty)

    await pendingHandle.dispose()
    resolveContent(<strong>Too late</strong>)
    await Promise.resolve()
    expect(cancelledContainer.textContent).toBe("")
  })

  it("catches initial render, event, and reactive-update failures within a boundary", async () => {
    const errors: Array<unknown> = []

    const renderFailure = new Error("initial render failed")

    const Broken = defineComponent(() =>
      Effect.sync(() => {
        throw renderFailure
      })
    )

    const renderContainer = document.createElement("div")

    const RenderApp = defineComponent(() =>
      Effect.succeed(
        <ErrorBoundary fallback={(error) => <p>Render error: {String(error)}</p>}>
          <Broken />
        </ErrorBoundary>
      )
    )

    const renderHandle = mount(RenderApp, renderContainer, Layer.empty, {
      onError: (error) => errors.push(error)
    })

    expect(renderContainer.textContent).toContain("initial render failed")
    expect(errors).toEqual([])
    await renderHandle.dispose()

    const eventContainer = document.createElement("div")

    const eventFailure = new Error("event failed")

    const EventApp = defineComponent(() =>
      Effect.succeed(
        <ErrorBoundary fallback={(error) => <p>Event error: {String(error)}</p>}>
          <button onClick={Effect.fail(eventFailure)}>Run</button>
        </ErrorBoundary>
      )
    )

    const eventHandle = mount(EventApp, eventContainer, Layer.empty, {
      onError: (error) => errors.push(error)
    })

    eventContainer.querySelector("button")!.click()
    await vi.waitFor(() => expect(eventContainer.textContent).toContain("event failed"))
    expect(errors).toEqual([])
    await eventHandle.dispose()

    const href = Effect.runSync(Signal.make("https://example.com"))

    const reactiveContainer = document.createElement("div")

    const ReactiveApp = defineComponent(() =>
      Effect.succeed(
        <ErrorBoundary fallback={(error) => <p>Update error: {String(error)}</p>}>
          <a href={href}>Safe link</a>
        </ErrorBoundary>
      )
    )

    const reactiveHandle = mount(ReactiveApp, reactiveContainer, Layer.empty, {
      onError: (error) => errors.push(error)
    })

    await Effect.runPromise(href.set("javascript:alert(1)"))
    await vi.waitFor(() => expect(reactiveContainer.textContent).toContain("executable URL"))
    expect(errors).toEqual([])
    await reactiveHandle.dispose()
  })

  it("resets a boundary and retries its child subtree", async () => {
    let shouldFail = true

    const container = document.createElement("div")

    const MaybeBroken = defineComponent(() =>
      Effect.sync(() => {
        if (shouldFail) throw new Error("try again")

        return <p>Recovered</p>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <ErrorBoundary
          fallback={(error, reset) => (
            <div>
              <p>{String(error)}</p>
              <button
                onClick={() => {
                  shouldFail = false
                  reset()
                }}
              >
                Retry
              </button>
            </div>
          )}
        >
          <MaybeBroken />
        </ErrorBoundary>
      )
    )

    const handle = mount(App, container, Layer.empty)

    expect(container.textContent).toContain("try again")
    container.querySelector("button")!.click()
    await vi.waitFor(() => expect(container.textContent).toBe("Recovered"))

    await handle.dispose()
  })

  it("resolves string, array, and conditional object class values", async () => {
    const Container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <b class="plain" />
          <i className="aliased" />
          <u class="first" className="second" />
          <span class={["base", false, null, ["nested", { on: true, off: false, none: null }]]} />
          <em class={[false, null]} />
        </>
      )
    )

    const Handle = mount(App, Container, Layer.empty)
    expect(Container.querySelector("b")?.getAttribute("class")).toBe("plain")
    expect(Container.querySelector("i")?.getAttribute("class")).toBe("aliased")
    expect(Container.querySelector("u")?.getAttribute("class")).toBe("first")
    expect(Container.querySelector("span")?.getAttribute("class")).toBe("base nested on")
    expect(Container.querySelector("em")?.hasAttribute("class")).toBe(false)

    await Handle.dispose()
  })

  it("rebinds class attributes from Signal-wrapped class values", async () => {
    const IsActive = Effect.runSync(Signal.make(false))
    const ClassNames = Effect.runSync(Signal.make<ClassValue>(["base", { active: IsActive.value }]))
    const Container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <span class={ClassNames} />
          <output className={ClassNames} />
        </>
      )
    )

    const Handle = mount(App, Container, Layer.empty)
    const Span = Container.querySelector("span")!
    const Output = Container.querySelector("output")!
    expect(Span.getAttribute("class")).toBe("base")
    expect(Output.getAttribute("class")).toBe("base")

    await Effect.runPromise(IsActive.set(true))
    await Effect.runPromise(
      ClassNames.set(["base", "ready", { active: IsActive.value, done: false }])
    )
    await vi.waitFor(() => {
      expect(Span.getAttribute("class")).toBe("base ready active")
      expect(Output.getAttribute("class")).toBe("base ready active")
    })

    await Effect.runPromise(ClassNames.set(null))
    await vi.waitFor(() => {
      expect(Span.hasAttribute("class")).toBe(false)
      expect(Output.hasAttribute("class")).toBe(false)
    })

    await Handle.dispose()
  })

  it("updates Show in place without disturbing sibling order", async () => {
    const visible = Effect.runSync(Signal.make(false))
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <div>
          <span>before</span>
          <Show when={visible} fallback={<i>hidden</i>}>
            <b>visible</b>
          </Show>
          <span>after</span>
        </div>
      )
    )

    const handle = mount(App, container, Layer.empty)
    expect(container.textContent).toBe("beforehiddenafter")

    await Effect.runPromise(visible.set(true))
    await vi.waitFor(() => expect(container.textContent).toBe("beforevisibleafter"))

    await Effect.runPromise(visible.set(false))
    await vi.waitFor(() => expect(container.textContent).toBe("beforehiddenafter"))
    await handle.dispose()
  })

  it("awaits an in-progress Show transition during root disposal", async () => {
    const visible = Effect.runSync(Signal.make(true))
    const container = document.createElement("div")
    let cleanupStarted = false
    let finishCleanup!: () => void

    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })

    const Child = defineComponent(() =>
      Effect.gen(function* () {
        yield* onCleanup(async () => {
          cleanupStarted = true
          await cleanupGate
        })

        return <span>child</span>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <Show when={visible}>
          <Child />
        </Show>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const switching = Effect.runPromise(visible.set(false))
    await vi.waitFor(() => expect(cleanupStarted).toBe(true))

    let disposed = false

    const disposing = handle.dispose().then(() => {
      disposed = true
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    finishCleanup()
    await Promise.all([switching, disposing])
    expect(disposed).toBe(true)
  })

  it("flushes nested dynamic mount hooks after the whole parent subtree is inserted", async () => {
    const visible = Effect.runSync(Signal.make(false))
    const container = document.createElement("div")
    let mountedWithParent = false

    const Child = defineComponent(() =>
      Effect.gen(function* () {
        yield* onMount(() => {
          mountedWithParent = container.querySelector("section") !== null
        })

        return <span>child</span>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <Show when={visible}>
          <section>
            <Show when={true}>
              <Child />
            </Show>
          </section>
        </Show>
      )
    )

    const handle = mount(App, container, Layer.empty)
    await Effect.runPromise(visible.set(true))
    await vi.waitFor(() => expect(mountedWithParent).toBe(true))
    await handle.dispose()
  })

  it("serializes ARIA/data booleans as values but HTML booleans by presence", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(<button aria-pressed={false} data-active={true} disabled={true} />)
    )

    const handle = mount(App, container, Layer.empty)
    const button = container.querySelector("button")!

    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(button.getAttribute("data-active")).toBe("true")
    expect(button.hasAttribute("disabled")).toBe(true)

    await handle.dispose()
  })

  it("never serializes unhandled event-like props as executable HTML attributes", async () => {
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(jsx("img", { onerror: "window.__effectUiXss = true" }))
    )

    const handle = mount(App, container, Layer.empty)
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false)
    await handle.dispose()
  })

  it("rejects executable URL schemes, including control-character obfuscation", async () => {
    const Href = Effect.runSync(Signal.make("https://example.com"))
    const Container = document.createElement("div")
    const Errors: Array<unknown> = []
    const App = defineComponent(() => Effect.succeed(<a href={Href}>open</a>))

    const Handle = mount(App, Container, Layer.empty, {
      onError: (RuntimeError) => Errors.push(RuntimeError)
    })

    const Link = Container.querySelector("a")!
    expect(Link.getAttribute("href")).toBe("https://example.com")

    await Effect.runPromise(Href.set("java\nscript:alert(1)"))
    await vi.waitFor(() => expect(Errors).toHaveLength(1))
    expect(Link.hasAttribute("href")).toBe(false)
    await Handle.dispose()
  })

  it("rejects iframe srcdoc attributes", () => {
    const Container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        jsx("iframe", {
          srcDoc: "<script>parent.document.body.dataset.xss = 'true'</script>"
        })
      )
    )

    expect(() => mount(App, Container, Layer.empty)).toThrow(/srcdoc attribute is not supported/)
    expect(Container.querySelector("iframe")).toBeNull()
  })

  it("rejects raw HTML and text content sinks from untyped JSX factories", () => {
    const Container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(jsx("div", { innerHTML: "<img src=x onerror=alert(1)>" }))
    )

    expect(() => mount(App, Container, Layer.empty)).toThrow(/raw HTML and text content/)
    expect(Container.querySelector("img")).toBeNull()
    expect(Container.innerHTML).toBe("")
  })

  it("blocks data URLs for embedded documents and allows image data URLs", async () => {
    const FrameContainer = document.createElement("div")
    const FrameSource = "data:text/html,<script>window.__embeddedScript = true</script>"
    const FrameApp = defineComponent(() => Effect.succeed(<iframe src={FrameSource} />))
    expect(() => mount(FrameApp, FrameContainer, Layer.empty)).toThrow(
      /data URLs are not supported in embedded documents/
    )
    expect(FrameContainer.querySelector("iframe")).toBeNull()

    const ImageContainer = document.createElement("div")
    const ImageApp = defineComponent(() => Effect.succeed(<img src="data:image/png;base64,AAAA" />))
    const Handle = mount(ImageApp, ImageContainer, Layer.empty)
    expect(ImageContainer.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA"
    )
    await Handle.dispose()
  })

  it("rejects script elements in HTML and SVG", () => {
    const Payload = "window.__effectUiExecuted = true"
    const HtmlContainer = document.createElement("div")
    const HtmlApp = defineComponent(() => Effect.succeed(<script>{Payload}</script>))
    expect(() => mount(HtmlApp, HtmlContainer, Layer.empty)).toThrow(
      /script elements are not supported/
    )
    expect(HtmlContainer.querySelector("script")).toBeNull()

    const SvgContainer = document.createElement("div")

    const SvgApp = defineComponent(() =>
      Effect.succeed(
        <svg>
          <script>{Payload}</script>
        </svg>
      )
    )

    expect(() => mount(SvgApp, SvgContainer, Layer.empty)).toThrow(
      /script elements are not supported/
    )
    expect(SvgContainer.querySelector("script")).toBeNull()

    const QualifiedSvgContainer = document.createElement("div")

    const QualifiedSvgApp = defineComponent(() =>
      Effect.succeed(<svg>{jsx("x:script", { children: Payload })}</svg>)
    )

    expect(() => mount(QualifiedSvgApp, QualifiedSvgContainer, Layer.empty)).toThrow(
      /script elements are not supported/
    )
    expect(QualifiedSvgContainer.querySelector("script")).toBeNull()
  })

  it("rejects SVG SMIL animation elements", () => {
    const AnimateContainer = document.createElement("div")

    const AnimateApp = defineComponent(() =>
      Effect.succeed(
        <svg>
          <a href="#target">
            <text>open</text>
            {jsx("animate", {
              attributeName: "href",
              values: "javascript:alert(1)",
              begin: "0s",
              dur: "1s",
              fill: "freeze"
            })}
          </a>
        </svg>
      )
    )

    expect(() => mount(AnimateApp, AnimateContainer, Layer.empty)).toThrow(
      /SVG animation elements are not supported/
    )
    expect(AnimateContainer.querySelector("animate")).toBeNull()

    const SetContainer = document.createElement("div")

    const SetApp = defineComponent(() =>
      Effect.succeed(
        <svg>
          <a href="#target">
            <text>open</text>
            {jsx("set", { attributeName: "href", to: "javascript:alert(1)", begin: "0s" })}
          </a>
        </svg>
      )
    )

    expect(() => mount(SetApp, SetContainer, Layer.empty)).toThrow(
      /SVG animation elements are not supported/
    )
    expect(SetContainer.querySelector("set")).toBeNull()

    const QualifiedAnimateContainer = document.createElement("div")

    const QualifiedAnimateApp = defineComponent(() =>
      Effect.succeed(
        <svg>
          <a href="#target">
            {jsx("x:animate", {
              attributeName: "href",
              values: "javascript:alert(1)",
              begin: "0s",
              dur: "1s",
              fill: "freeze"
            })}
          </a>
        </svg>
      )
    )

    expect(() => mount(QualifiedAnimateApp, QualifiedAnimateContainer, Layer.empty)).toThrow(
      /SVG animation elements are not supported/
    )
    expect(QualifiedAnimateContainer.querySelector("animate")).toBeNull()
  })

  it("accepts required props on the root component", async () => {
    const container = document.createElement("div")

    const App = defineComponent((props: { readonly label: string }) =>
      Effect.succeed(<span>{props.label}</span>)
    )

    const handle = mount(App, container, Layer.empty, { props: { label: "root props" } })
    expect(container.textContent).toBe("root props")
    await handle.dispose()
  })

  it("binds form properties, numeric styles, and nested SVG elements", async () => {
    const value = Effect.runSync(Signal.make("initial"))
    const checked = Effect.runSync(Signal.make(true))
    const selected = Effect.runSync(Signal.make("b"))

    const style = Effect.runSync(
      Signal.make<StyleLike>({ width: 12, opacity: 0.5, "--accent": "red" })
    )

    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <input value={value} checked={checked} />
          <select value={selected}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
          <div style={style} />
          <svg viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" strokeWidth={2} />
            <foreignObject>
              <div>HTML in SVG</div>
            </foreignObject>
          </svg>
        </>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const input = container.querySelector("input")!
    const select = container.querySelector("select")!
    const styled = container.querySelector("div")!
    const svg = container.querySelector("svg")!
    const circle = container.querySelector("circle")!
    const foreignContent = container.querySelector("foreignObject div")!

    expect(input.value).toBe("initial")
    expect(input.checked).toBe(true)
    expect(select.value).toBe("b")
    expect(styled.style.width).toBe("12px")
    expect(styled.style.opacity).toBe("0.5")
    expect(styled.style.getPropertyValue("--accent")).toBe("red")
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(circle.getAttribute("stroke-width")).toBe("2")
    expect(foreignContent.namespaceURI).toBe("http://www.w3.org/1999/xhtml")

    await Effect.runPromise(value.set("updated"))
    await Effect.runPromise(checked.set(false))
    await Effect.runPromise(selected.set("a"))
    await Effect.runPromise(style.set({ height: 8, opacity: 0.25 }))
    await vi.waitFor(() => {
      expect(input.value).toBe("updated")
      expect(input.checked).toBe(false)
      expect(select.value).toBe("a")
      expect(styled.style.width).toBe("")
      expect(styled.style.height).toBe("8px")
      expect(styled.style.opacity).toBe("0.25")
      expect(styled.style.getPropertyValue("--accent")).toBe("")
    })

    await handle.dispose()
  })

  it("preserves controlled values and resets uncontrolled fields after native form reset", async () => {
    const controlledValue = Effect.runSync(Signal.make("controlled value"))
    const controlledChecked = Effect.runSync(Signal.make(false))
    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <form>
          <input defaultValue="uncontrolled initial" />
          <input value={controlledValue} />
          <input type="checkbox" defaultChecked checked={controlledChecked} />
        </form>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const form = container.querySelector("form")!
    const inputs = form.querySelectorAll("input")
    const uncontrolled = inputs[0]
    const controlled = inputs[1]
    const checkbox = inputs[2]

    expect(controlled.form).toBe(form)

    await Effect.runPromise(controlledValue.set("latest controlled value"))
    await vi.waitFor(() => expect(controlled.value).toBe("latest controlled value"))
    uncontrolled.value = "user edit"
    checkbox.click()

    expect(checkbox.checked).toBe(true)
    let resetEventSeen = false
    form.addEventListener("reset", () => {
      resetEventSeen = true
    })
    form.reset()

    expect(resetEventSeen).toBe(true)
    expect(uncontrolled.value).toBe("uncontrolled initial")
    await vi.waitFor(() => {
      expect(controlled.value).toBe("latest controlled value")
      expect(checkbox.checked).toBe(false)
    })

    await handle.dispose()
  })

  it("delivers typed input and composition events to the native element callback", async () => {
    const container = document.createElement("div")
    let composedText = ""
    let currentValue = ""

    const App = defineComponent(() =>
      Effect.succeed(
        <input
          onCompositionEnd={(event) => {
            composedText = event.data
            currentValue = event.currentTarget.value
          }}
        />
      )
    )

    const handle = mount(App, container, Layer.empty)
    const input = container.querySelector("input")!
    const composition = new CompositionEvent("compositionend", { bubbles: true })
    Object.defineProperty(composition, "data", { value: "é" })

    input.value = "éclair"
    input.dispatchEvent(composition)

    expect(composedText).toBe("é")
    expect(currentValue).toBe("éclair")

    await handle.dispose()
  })

  it("focuses and blurs referenced controls while skipping unavailable descendants", async () => {
    const container = document.createElement("div")
    const sectionRef = createRef<HTMLElement>()
    const inputRef = createRef<HTMLInputElement>()

    const App = defineComponent(() =>
      Effect.succeed(
        <section ref={sectionRef}>
          <button disabled>Unavailable</button>
          <input ref={inputRef} aria-label="Search" />
          <button>Next</button>
        </section>
      )
    )

    document.body.append(container)

    const handle = mount(App, container, Layer.empty)
    const first = await Effect.runPromise(focusFirst(sectionRef))

    expect(first).toBe(inputRef.current)
    expect(document.activeElement).toBe(inputRef.current)
    expect(await Effect.runPromise(blur(inputRef))).toBe(true)
    expect(document.activeElement).not.toBe(inputRef.current)
    expect(await Effect.runPromise(focus(inputRef))).toBe(true)

    await handle.dispose()
    container.remove()
  })

  it("routes event-effect failures through the mount error handler", async () => {
    const container = document.createElement("div")
    const errors: Array<unknown> = []

    const App = defineComponent(() =>
      Effect.succeed(<button onKeyDown={Effect.fail(new Error("action failed"))}>run</button>)
    )

    const handle = mount(App, container, Layer.empty, { onError: (error) => errors.push(error) })
    container.querySelector("button")!.dispatchEvent(new Event("keydown"))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toEqual(new Error("action failed"))
    await handle.dispose()
  })

  it("passes typed native events to callbacks and reports callback failures", async () => {
    const container = document.createElement("div")
    const errors: Array<unknown> = []
    let receivedEvent: MouseEvent | undefined
    let effectRuns = 0
    let synchronousButton = -1
    const callbackError = new Error("native callback failed")

    const App = defineComponent(() =>
      Effect.succeed(
        <>
          <button
            onClick={(event) => {
              receivedEvent = event

              return Effect.sync(() => {
                effectRuns += 1
              })
            }}
          >
            run effect
          </button>
          <button
            onMouseDown={(event) => {
              synchronousButton = event.button
            }}
          >
            run synchronously
          </button>
          <button
            onDoubleClick={() => {
              throw callbackError
            }}
          >
            fail synchronously
          </button>
        </>
      )
    )

    const handle = mount(App, container, Layer.empty, { onError: (error) => errors.push(error) })
    const [effectButton, syncButton, callbackButton] = container.querySelectorAll("button")
    effectButton.click()

    expect(receivedEvent).toBeInstanceOf(MouseEvent)
    expect(receivedEvent?.button).toBe(0)
    await vi.waitFor(() => expect(effectRuns).toBe(1))

    syncButton.dispatchEvent(new MouseEvent("mousedown", { button: 2 }))
    expect(synchronousButton).toBe(2)

    callbackButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    await vi.waitFor(() => expect(errors).toEqual([callbackError]))
    await handle.dispose()
  })

  it("interrupts running event effects when their DOM subtree is removed", async () => {
    const visible = Effect.runSync(Signal.make(true))
    const container = document.createElement("div")
    let started = false
    let interrupted = 0

    const handler = Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          started = true
        })
        yield* Effect.never
      }),
      Effect.sync(() => {
        interrupted += 1
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <Show when={visible}>
          <button onClick={handler}>long action</button>
        </Show>
      )
    )

    const handle = mount(App, container, Layer.empty)
    container.querySelector("button")!.click()
    await vi.waitFor(() => expect(started).toBe(true))
    await Effect.runPromise(visible.set(false))
    await vi.waitFor(() => expect(interrupted).toBe(1))
    expect(container.querySelector("button")).toBeNull()
    await handle.dispose()
  })

  it("supports async lifecycle callbacks and awaits cleanup callbacks", async () => {
    const container = document.createElement("div")
    let mounted = false
    let cleanupStarted = false
    let cleaned = false
    let finishCleanup!: () => void

    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })

    const App = defineComponent(() =>
      Effect.gen(function* () {
        yield* onMount(async () => {
          await Promise.resolve()
          mounted = true
        })
        yield* onCleanup(async () => {
          cleanupStarted = true
          await cleanupGate
          cleaned = true
        })

        return <span>lifecycle</span>
      })
    )

    const handle = mount(App, container, Layer.empty)
    expect(cleanupStarted).toBe(false)
    expect(cleaned).toBe(false)
    await vi.waitFor(() => expect(mounted).toBe(true))
    expect(cleanupStarted).toBe(false)

    let disposed = false

    const disposing = handle.dispose().then(() => {
      disposed = true
    })

    await vi.waitFor(() => expect(cleanupStarted).toBe(true))
    expect(disposed).toBe(false)
    finishCleanup()
    await disposing
    expect(cleaned).toBe(true)
  })
  it("waits for async mount callbacks before running cleanup", async () => {
    const Container = document.createElement("div")
    let FinishMount!: () => void

    const MountGate = new Promise<void>((Resolve) => {
      FinishMount = Resolve
    })

    let MountedCallbacks = 0
    let CleanupStarted = false
    let FinishCleanup!: () => void

    const CleanupGate = new Promise<void>((Resolve) => {
      FinishCleanup = Resolve
    })

    const RegisterLifecycle = function* () {
      yield* onMount(async () => {
        await MountGate
        MountedCallbacks += 1
      })
      yield* onCleanup(async () => {
        CleanupStarted = true
        await CleanupGate
      })
    }

    const Child = defineComponent(() =>
      Effect.gen(function* () {
        yield* RegisterLifecycle()

        return <span>child</span>
      })
    )

    const App = defineComponent(() =>
      Effect.gen(function* () {
        yield* RegisterLifecycle()

        return <Child />
      })
    )

    const Handle = mount(App, Container, Layer.empty)
    let Disposed = false

    const Disposing = Handle.dispose().then(() => {
      Disposed = true
    })

    await new Promise<void>((Resolve) => setTimeout(Resolve, 0))
    expect(MountedCallbacks).toBe(0)
    expect(CleanupStarted).toBe(false)
    expect(Disposed).toBe(false)

    FinishMount()
    await vi.waitFor(() => expect(MountedCallbacks).toBe(2))
    await vi.waitFor(() => expect(CleanupStarted).toBe(true))
    expect(Disposed).toBe(false)
    FinishCleanup()
    await Disposing
    expect(Disposed).toBe(true)
  })

  it("reports synchronous and asynchronous mount callback failures", async () => {
    const container = document.createElement("div")
    const errors: Array<unknown> = []
    const syncError = new Error("sync mount failed")
    const asyncError = new Error("async mount failed")

    const App = defineComponent(() =>
      Effect.gen(function* () {
        yield* onMount(() => {
          throw syncError
        })
        yield* onMount(() => Promise.reject(asyncError))

        return <span>mounted</span>
      })
    )

    const handle = mount(App, container, Layer.empty, { onError: (error) => errors.push(error) })
    await vi.waitFor(() => expect(errors).toEqual([syncError, asyncError]))
    expect(container.textContent).toBe("mounted")
    await handle.dispose()
  })

  it("reconciles keyed For rows and disposes removed component scopes", async () => {
    interface Item {
      readonly id: number
      readonly label: string
    }

    const one: Item = { id: 1, label: "one" }
    const two: Item = { id: 2, label: "two" }
    const three: Item = { id: 3, label: "three" }
    const items = Effect.runSync(Signal.make<ReadonlyArray<Item>>([one, two, three]))
    const container = document.createElement("div")
    const mounted: Array<number> = []
    const cleaned: Array<number> = []
    const scopedCleaned: Array<number> = []

    const Row = defineComponent((props: { readonly item: Item }) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => Promise.resolve().then(() => void scopedCleaned.push(props.item.id)))
        )
        yield* onMount(() => mounted.push(props.item.id))
        yield* onCleanup(() => cleaned.push(props.item.id))

        return <li data-id={props.item.id}>{props.item.label}</li>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <ul>
          <For each={items} keyOf={(item: Item) => item.id}>
            {(item: Item) => <Row item={item} />}
          </For>
        </ul>
      )
    )

    const handle = mount(App, container, Layer.empty)
    expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
      "one",
      "two",
      "three"
    ])
    expect(mounted).toEqual([1, 2, 3])

    const list = container.querySelector("ul")!
    const originalThree = container.querySelector('li[data-id="3"]')
    const insertBefore = vi.spyOn(list, "insertBefore")
    await Effect.runPromise(items.set([three, two, one]))
    await vi.waitFor(() => {
      expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
        "three",
        "two",
        "one"
      ])
    })
    expect(container.querySelector('li[data-id="3"]')).toBe(originalThree)
    // Marker-free entries move exactly their rendered nodes: two single-node
    // regions change position for this reversal.
    expect(insertBefore).toHaveBeenCalledTimes(2)
    insertBefore.mockRestore()

    await Effect.runPromise(items.set([three, { id: 1, label: "ONE" }, { id: 4, label: "four" }]))
    await vi.waitFor(() => {
      expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
        "three",
        "ONE",
        "four"
      ])
    })
    expect(cleaned).toEqual([1, 2])
    expect(scopedCleaned).toEqual([1, 2])
    expect(mounted).toEqual([1, 2, 3, 1, 4])

    await handle.dispose()
    expect(cleaned.sort()).toEqual([1, 1, 2, 3, 4])
    expect(scopedCleaned.sort()).toEqual([1, 1, 2, 3, 4])
  })

  it("reconciles keyed rows that render nothing without marker nodes", async () => {
    interface Item {
      readonly id: number
      readonly label: string | null
    }

    const items = Effect.runSync(
      Signal.make<ReadonlyArray<Item>>([
        { id: 1, label: "one" },
        { id: 2, label: null },
        { id: 3, label: "three" }
      ])
    )

    const container = document.createElement("div")

    const App = defineComponent(() =>
      Effect.succeed(
        <ul>
          <For each={items} keyOf={(item: Item) => item.id}>
            {(item: Item) => (item.label === null ? null : <li data-id={item.id}>{item.label}</li>)}
          </For>
        </ul>
      )
    )

    const handle = mount(App, container, Layer.empty)
    expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
      "one",
      "three"
    ])

    await Effect.runPromise(
      items.set([
        { id: 3, label: "three" },
        { id: 2, label: "two" },
        { id: 1, label: "one" }
      ])
    )
    await vi.waitFor(() => {
      expect(Array.from(container.querySelectorAll("li"), (row) => row.textContent)).toEqual([
        "three",
        "two",
        "one"
      ])
    })

    await Effect.runPromise(items.set([{ id: 2, label: null }]))
    await vi.waitFor(() => {
      expect(container.querySelectorAll("li")).toHaveLength(0)
    })

    await handle.dispose()
    expect(container.textContent).toBe("")
  })

  it("awaits an in-progress keyed row replacement during root disposal", async () => {
    interface Item {
      readonly id: number
      readonly label: string
    }

    const oldItem: Item = { id: 1, label: "old" }
    const newItem: Item = { id: 1, label: "new" }
    const items = Effect.runSync(Signal.make<ReadonlyArray<Item>>([oldItem]))
    const container = document.createElement("div")
    let cleanupStarted = false
    let finishCleanup!: () => void

    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })

    const Row = defineComponent((props: { readonly item: Item }) =>
      Effect.gen(function* () {
        if (props.item === oldItem) {
          yield* onCleanup(async () => {
            cleanupStarted = true
            await cleanupGate
          })
        }

        return <span>{props.item.label}</span>
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <For each={items} keyOf={(item: Item) => item.id}>
          {(item: Item) => <Row item={item} />}
        </For>
      )
    )

    const handle = mount(App, container, Layer.empty)
    const replacing = Effect.runPromise(items.set([newItem]))
    await vi.waitFor(() => expect(cleanupStarted).toBe(true))

    let disposed = false

    const disposing = handle.dispose().then(() => {
      disposed = true
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    finishCleanup()
    await Promise.all([replacing, disposing])
    expect(disposed).toBe(true)
  })

  it("disposes only its owned DOM range and awaits asynchronous finalizers", async () => {
    const container = document.createElement("div")
    const before = document.createElement("span")
    before.textContent = "before"
    container.append(before)
    let finalized = false

    const App = defineComponent(() =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => Promise.resolve().then(() => void (finalized = true)))
        )

        return <b>owned</b>
      })
    )

    const handle = mount(App, container, Layer.empty)
    const after = document.createElement("i")
    after.textContent = "after"
    container.append(after)

    const disposing = handle.dispose()
    expect(container.textContent).toBe("beforeafter")
    expect(finalized).toBe(false)
    await disposing
    await handle.dispose()

    expect(finalized).toBe(true)
    expect(Array.from(container.children)).toEqual([before, after])
  })

  it("isolates multiple mounts that share one container", async () => {
    const container = document.createElement("div")
    const First = defineComponent(() => Effect.succeed(<span>first</span>))
    const Second = defineComponent(() => Effect.succeed(<span>second</span>))
    const first = mount(First, container, Layer.empty)
    const second = mount(Second, container, Layer.empty)

    expect(container.textContent).toBe("firstsecond")
    await first.dispose()
    expect(container.textContent).toBe("second")
    await second.dispose()
    expect(container.textContent).toBe("")
  })

  it("creates nodes in the container's owner document", async () => {
    const ownerDocument = document.implementation.createHTMLDocument("other document")
    const container = ownerDocument.createElement("div")
    const App = defineComponent(() => Effect.succeed(<p>other document</p>))

    const handle = mount(App, container, Layer.empty)
    expect(container.firstChild?.ownerDocument).toBe(ownerDocument)
    expect(container.querySelector("p")?.ownerDocument).toBe(ownerDocument)
    await handle.dispose()
  })

  it("rolls back a failed mount without removing pre-existing DOM", async () => {
    const container = document.createElement("div")
    const existing = document.createElement("span")
    existing.textContent = "existing"
    container.append(existing)
    let cleanupCount = 0

    const Broken = defineComponent(() =>
      Effect.gen(function* () {
        yield* onCleanup(() => {
          cleanupCount += 1
        })

        return yield* Effect.fail(new Error("render failed"))
      })
    )

    const App = defineComponent(() =>
      Effect.succeed(
        <div>
          <Broken />
        </div>
      )
    )

    expect(() => mount(App, container, Layer.empty)).toThrow()
    await vi.waitFor(() => expect(cleanupCount).toBe(1))
    expect(container.textContent).toBe("existing")
    expect(Array.from(container.children)).toEqual([existing])
  })

  it("keeps a keyed For watcher alive after rejecting duplicate keys", async () => {
    const one = { id: 1, label: "one" }
    const two = { id: 2, label: "two" }
    const items = Effect.runSync(Signal.make<ReadonlyArray<typeof one>>([one]))
    const container = document.createElement("div")
    const errors: Array<unknown> = []

    const App = defineComponent(() =>
      Effect.succeed(
        <For each={items} keyOf={(item: typeof one) => item.id}>
          {(item: typeof one) => <span>{item.label}</span>}
        </For>
      )
    )

    const handle = mount(App, container, Layer.empty, { onError: (error) => errors.push(error) })
    await Effect.runPromise(items.set([one, { id: 1, label: "duplicate" }]))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(container.textContent).toBe("one")

    await Effect.runPromise(items.set([two]))
    await vi.waitFor(() => expect(container.textContent).toBe("two"))
    await handle.dispose()
  })

  it("does not run mount hooks from a rolled-back dynamic subtree", async () => {
    interface Item {
      readonly id: number
      readonly broken: boolean
    }

    const items = Effect.runSync(Signal.make<ReadonlyArray<Item>>([]))
    const container = document.createElement("div")
    const errors: Array<unknown> = []
    const mounted: Array<number> = []
    const cleaned: Array<number> = []

    const Row = defineComponent((props: { readonly id: number }) =>
      Effect.gen(function* () {
        yield* onMount(() => mounted.push(props.id))
        yield* onCleanup(() => cleaned.push(props.id))

        return <span>{props.id}</span>
      })
    )

    const Broken = defineComponent(() => Effect.fail(new Error("row failed")))

    const App = defineComponent(() =>
      Effect.succeed(
        <For each={items} keyOf={(item: Item) => item.id}>
          {(item: Item) =>
            item.broken ? (
              <>
                <Row id={item.id} />
                <Broken />
              </>
            ) : (
              <Row id={item.id} />
            )
          }
        </For>
      )
    )

    const handle = mount(App, container, Layer.empty, { onError: (error) => errors.push(error) })
    await Effect.runPromise(items.set([{ id: 1, broken: true }]))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(container.textContent).toBe("")
    expect(mounted).toEqual([])
    await vi.waitFor(() => expect(cleaned).toEqual([1]))

    await Effect.runPromise(items.set([{ id: 2, broken: false }]))
    await vi.waitFor(() => expect(container.textContent).toBe("2"))
    expect(mounted).toEqual([2])
    await handle.dispose()
  })
  it("recovers a keyed row after a replacement render fails", async () => {
    interface Item {
      readonly id: number
      readonly label: string
      readonly broken?: boolean
    }

    const Original: Item = { id: 1, label: "original" }
    const BrokenItem: Item = { id: 1, label: "broken", broken: true }
    const Items = Effect.runSync(Signal.make<ReadonlyArray<Item>>([Original]))
    const Container = document.createElement("div")
    const Errors: Array<unknown> = []
    const Broken = defineComponent(() => Effect.fail(new Error("row render failed")))

    const App = defineComponent(() =>
      Effect.succeed(
        <For each={Items} keyOf={(ItemValue: Item) => ItemValue.id}>
          {(ItemValue: Item) => (ItemValue.broken ? <Broken /> : <span>{ItemValue.label}</span>)}
        </For>
      )
    )

    const Handle = mount(App, Container, Layer.empty, {
      onError: (RuntimeError) => Errors.push(RuntimeError)
    })

    expect(Container.textContent).toBe("original")

    await Effect.runPromise(Items.set([BrokenItem]))
    await vi.waitFor(() => expect(Errors).toHaveLength(1))
    expect(Container.textContent).toBe("")

    await Effect.runPromise(Items.set([Original]))
    await vi.waitFor(() => expect(Container.textContent).toBe("original"))
    await Handle.dispose()
  })
})
