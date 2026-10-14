import { Effect, Layer, Schema } from "effect"
import * as FetchHttpClientModule from "effect/http/FetchHttpClient"
import * as EffectHttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as EffectHttpClientResponse from "effect/http/HttpClientResponse"

export * as FetchHttpClient from "effect/http/FetchHttpClient"

export * as HttpClient from "effect/http/HttpClient"

export * as HttpClientError from "effect/http/HttpClientError"

export * as HttpClientRequest from "effect/http/HttpClientRequest"

export * as HttpClientResponse from "effect/http/HttpClientResponse"

export interface BrowserHttpLayerOptions {
  /** Optional Fetch-compatible transport, useful for tests and custom adapters. */
  readonly fetch?: typeof globalThis.fetch
  /** Default browser Fetch options such as credentials or redirect handling. */
  readonly requestInit?: globalThis.RequestInit
  /** Applies shared middleware once when the layer builds its Fetch client. */
  readonly configureClient?: (Client: EffectHttpClient.HttpClient) => EffectHttpClient.HttpClient
}

/** Provides Effect's browser Fetch client with optional transport and middleware defaults. */
export const browserLayer = (Options: BrowserHttpLayerOptions = {}) => {
  const FetchLayer =
    Options.fetch === undefined
      ? Layer.empty
      : Layer.succeed(FetchHttpClientModule.Fetch, Options.fetch)

  const RequestInitLayer =
    Options.requestInit === undefined
      ? Layer.empty
      : Layer.succeed(FetchHttpClientModule.RequestInit, Options.requestInit)

  const FetchClientLayer = Layer.provide(
    FetchHttpClientModule.layer,
    Layer.mergeAll(FetchLayer, RequestInitLayer)
  )

  if (Options.configureClient === undefined) return FetchClientLayer

  const ConfiguredClientLayer = Layer.effect(
    EffectHttpClient.HttpClient,
    Effect.map(EffectHttpClient.HttpClient, Options.configureClient)
  )

  return Layer.provide(ConfiguredClientLayer, FetchClientLayer)
}

/** Executes a request, requires a successful status, and decodes its JSON body. */
export const json = <S extends Schema.Constraint>(
  Request: HttpClientRequest.HttpClientRequest,
  JsonSchema: S
) =>
  Effect.gen(function* () {
    const Client = yield* EffectHttpClient.HttpClient
    const Response = yield* Client.execute(Request)
    const SuccessfulResponse = yield* EffectHttpClientResponse.filterStatusOk(Response)

    return yield* EffectHttpClientResponse.schemaBodyJson(JsonSchema)(SuccessfulResponse)
  })

/** Prepends an absolute service base URL to each request made by the client. */
export const withBaseUrl = <E, R>(
  Client: EffectHttpClient.HttpClient.With<E, R>,
  BaseUrl: string | URL
): EffectHttpClient.HttpClient.With<E, R> =>
  Client.pipe(EffectHttpClient.mapRequest(HttpClientRequest.prependUrl(String(BaseUrl))))

const NormalizeBffPrefix = (Prefix: string): string => {
  const Url = new URL(Prefix, "https://effect-ui.invalid")

  if (
    Url.origin !== "https://effect-ui.invalid" ||
    Url.pathname === "/" ||
    Url.search.length > 0 ||
    Url.hash.length > 0
  ) {
    throw new TypeError("[@effect/ui] a BFF prefix must be a non-root same-origin path")
  }

  return Url.pathname.replace(/\/+$/, "")
}

/** Rewrites requests to a same-origin backend-for-frontend path prefix. */
export const throughBff = <E, R>(
  Client: EffectHttpClient.HttpClient.With<E, R>,
  Prefix: string
): EffectHttpClient.HttpClient.With<E, R> =>
  Client.pipe(EffectHttpClient.mapRequest(HttpClientRequest.prependUrl(NormalizeBffPrefix(Prefix))))

export const layer = browserLayer

export const Http = { layer, browserLayer, json, withBaseUrl, throughBff }
