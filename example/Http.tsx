import { Async, defineComponent, Http, ResourceCache } from "@effect/ui"
import { HttpClient, HttpClientRequest } from "@effect/ui/http"
import { Effect, Schema } from "effect"

const DemoProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  servedBy: Schema.String,
  authenticated: Schema.Boolean
})

const DemoFetch: typeof globalThis.fetch = async (Input, Init) => {
  const Url = new URL(String(Input))
  const RequestHeaders = new Headers(Init?.headers)

  return new Response(
    JSON.stringify({
      id: Url.pathname.split("/").at(-1) ?? "unknown",
      name: "Ada Lovelace",
      servedBy: Url.pathname,
      authenticated: RequestHeaders.has("authorization")
    }),
    { headers: { "content-type": "application/json" } }
  )
}

export const HttpDemoLayer = Http.browserLayer({
  fetch: DemoFetch,
  configureClient: (Client) =>
    Http.throughBff(Client, "/bff").pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeader("authorization", "Bearer demo-token")),
      HttpClient.transformResponse((Response) =>
        Effect.tap(Response, (Value) =>
          Effect.sync(() => console.info("HTTP response intercepted", Value.status))
        )
      )
    )
})

const ProfileKey = ResourceCache.key(
  "http-demo-profile",
  (Id: string) => Id,
  (Id) =>
    Effect.map(Http.json(HttpClientRequest.get(`/users/${Id}`), DemoProfile), (Profile) => (
      <article>
        <h3>{Profile.name}</h3>
        <p>Routed through: {Profile.servedBy}</p>
        <p>Authorization interceptor ran: {String(Profile.authenticated)}</p>
      </article>
    )),
  "1 minute"
)

export const HttpView = defineComponent(() =>
  Effect.gen(function* () {
    const Cache = yield* ResourceCache.make()
    const Profile = yield* Cache.get(ProfileKey, "ada")

    return (
      <section aria-labelledby="http-title">
        <h2 id="http-title">HTTP client and query caching</h2>
        <p>
          This deterministic Fetch adapter rewrites requests to a same-origin BFF path, adds a
          request header, intercepts responses, validates JSON with Schema, and shares the result
          through ResourceCache.
        </p>
        <Async
          resource={Profile}
          fallback={<p role="status">Loading profile…</p>}
          error={(Cause) => <p role="alert">Request failed: {String(Cause)}</p>}
        />
        <button onClick={Profile.refresh}>Revalidate cached profile</button>
        <button onClick={Profile.cancel}>Cancel request</button>
      </section>
    )
  })
)
