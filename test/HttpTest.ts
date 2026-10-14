import { Effect, Fiber, Schema } from "effect"
import * as EffectHttpClient from "effect/http/HttpClient"
import * as EffectHttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { describe, expect, it } from "vitest"
import { Http } from "../src/Http.js"

const Profile = Schema.Struct({
  name: Schema.String,
  servedBy: Schema.String,
  authenticated: Schema.Boolean
})

describe("Http", () => {
  it("configures Effect middleware and rewrites requests to a BFF path", async () => {
    const SeenRequests: Array<{ readonly url: string; readonly authorization: string | null }> = []
    const InterceptedStatuses: Array<number> = []

    const Layer = Http.browserLayer({
      fetch: async (Input, Init) => {
        const Url = new URL(String(Input))
        const Headers = new globalThis.Headers(Init?.headers)

        SeenRequests.push({ url: Url.href, authorization: Headers.get("authorization") })

        return new Response(
          JSON.stringify({
            name: "Ada Lovelace",
            servedBy: Url.pathname,
            authenticated: Headers.has("authorization")
          }),
          { headers: { "content-type": "application/json" } }
        )
      },
      configureClient: (BaseClient) =>
        Http.throughBff(BaseClient, "/bff").pipe(
          EffectHttpClient.mapRequest(
            HttpClientRequest.setHeader("authorization", "Bearer test-token")
          ),
          EffectHttpClient.transformResponse((Response) =>
            Effect.tap(Response, (Value) =>
              Effect.sync(() => InterceptedStatuses.push(Value.status))
            )
          )
        )
    })

    const Program = Http.json(HttpClientRequest.get("/users/ada"), Profile).pipe(
      Effect.provide(Layer)
    )

    const Result = await Effect.runPromise(Program)

    expect(Result).toEqual({
      name: "Ada Lovelace",
      servedBy: "/bff/users/ada",
      authenticated: true
    })
    expect(new URL(SeenRequests[0]?.url ?? "https://invalid/").pathname).toBe("/bff/users/ada")
    expect(SeenRequests[0]?.authorization).toBe("Bearer test-token")
    expect(InterceptedStatuses).toEqual([200])
  })

  it("uses Effect's typed HTTP error for unsuccessful statuses", async () => {
    const Layer = Http.browserLayer({
      fetch: async () => new Response("unavailable", { status: 503, statusText: "Unavailable" })
    })

    const Program = Http.json(
      HttpClientRequest.get("https://app.example/unavailable"),
      Profile
    ).pipe(Effect.provide(Layer))

    const Failure = await Effect.runPromise(Effect.flip(Program))

    expect(Failure).toBeInstanceOf(EffectHttpClientError.HttpClientError)
  })

  it("returns Effect's schema error when a JSON body does not match its schema", async () => {
    const Layer = Http.browserLayer({
      fetch: async () =>
        new Response(JSON.stringify({ name: 42 }), {
          headers: { "content-type": "application/json" }
        })
    })

    const Program = Http.json(
      HttpClientRequest.get("https://app.example/profile"),
      Schema.Struct({ name: Schema.String })
    ).pipe(Effect.provide(Layer))

    const Failure = await Effect.runPromise(Effect.flip(Program))

    expect(Failure).toBeInstanceOf(Schema.SchemaError)
  })

  it("aborts the Fetch transport when the request Effect is interrupted", async () => {
    let MarkStarted: () => void = () => undefined
    let WasAborted = false
    const Started = new Promise<void>((Resolve) => (MarkStarted = Resolve))

    const Layer = Http.browserLayer({
      fetch: (_Input, Init) =>
        new Promise<Response>((_Resolve, Reject) => {
          const Signal = Init?.signal

          if (Signal === undefined || Signal === null) {
            Reject(new Error("Expected an abort signal"))

            return
          }

          Signal.addEventListener(
            "abort",
            () => {
              WasAborted = true
              Reject(new Error("interrupted"))
            },
            { once: true }
          )
          MarkStarted()
        })
    })

    const Program = Effect.gen(function* () {
      const Client = yield* EffectHttpClient.HttpClient

      return yield* Client.get("https://app.example/slow")
    }).pipe(Effect.provide(Layer))

    const RequestFiber = Effect.runFork(Program)

    await Started
    await Effect.runPromise(Fiber.interrupt(RequestFiber))

    expect(WasAborted).toBe(true)
  })
})
