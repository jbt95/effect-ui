import {
  Async,
  Component,
  Ref,
  Focus,
  Image,
  ResourceCache,
  Show,
  Signal,
  Transition
} from "@effect/ui"
import { Effect } from "effect"

interface Profile {
  readonly name: string
  readonly role: string
  readonly revision: number
}

const loadProfile = (id: string): Promise<Profile> =>
  new Promise((resolve) => {
    window.setTimeout(
      () =>
        resolve({
          name: id === "ada" ? "Ada Lovelace" : id,
          role: "Engineer",
          revision: Date.now()
        }),
      450
    )
  })

const ProfileKey = ResourceCache.key("example-profile", {
  identify: (id: string) => id,
  load: (id) => Effect.promise(() => loadProfile(id)),
  staleTime: "1 minute"
})

const formatAmount = (amount: number): string =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount)

const CreateResourcesModel = () =>
  Effect.gen(function* () {
    const Cache = yield* ResourceCache.make()
    const Profile = yield* Cache.get(ProfileKey, "ada")
    const SharedProfile = yield* Cache.get(ProfileKey, "ada")
    const Amount = yield* Signal.make(128)
    const AmountLabel = yield* Signal.memo([Amount], () => formatAmount(Amount.value))
    const ShowSavings = yield* Signal.memo([Amount], () => Amount.value >= 100)
    const SearchRef = Ref.make<HTMLInputElement>()
    const PreloadStatus = yield* Signal.make("Not preloaded yet")

    const PreloadSunrise = Image.preload("/sunrise.svg").pipe(
      Effect.tap(() => PreloadStatus.set("Decoded and ready")),
      Effect.catchTag("ImageLoadError", (ErrorValue) => PreloadStatus.set(ErrorValue.reason))
    )

    return {
      Profile,
      SharedProfile,
      Amount,
      AmountLabel,
      ShowSavings,
      SearchRef,
      PreloadStatus,
      PreloadSunrise
    }
  })

type EffectSuccess<Value> =
  Value extends Effect.Effect<infer Success, infer _Error, infer _Requirements> ? Success : never

type ResourcesModel = EffectSuccess<ReturnType<typeof CreateResourcesModel>>

const ProfileSection = (Model: ResourcesModel) => (
  <section aria-labelledby="profile-resource-title">
    <h3 id="profile-resource-title">Cached profile resource</h3>
    <p>
      Two consumers share the same in-flight entry: {String(Model.Profile === Model.SharedProfile)}
    </p>
    <Async.View
      source={Model.Profile}
      success={(Profile) => (
        <article>
          <h4>{Profile.name}</h4>
          <p>{Profile.role}</p>
          <small>Loaded at revision {Profile.revision}</small>
        </article>
      )}
      pending={<p role="status">Loading profile…</p>}
      failure={(cause) => <p role="alert">Could not load the profile: {String(cause)}</p>}
    />
    <button onClick={Model.Profile.refresh}>Refresh profile</button>
    <button onClick={Model.Profile.cancel}>Cancel profile load</button>
  </section>
)

const SelectorSection = (Model: ResourcesModel) => (
  <section aria-labelledby="selector-title">
    <h3 id="selector-title">Memoized selectors and transitions</h3>
    <p>Cart total: {Model.AmountLabel}</p>
    <Show.View when={Model.ShowSavings} fallback={<p>Add more to unlock savings.</p>}>
      <p>Free delivery unlocked.</p>
    </Show.View>
    <button onClick={Model.Amount.update((Value) => Value + 1)}>Update immediately</button>
    <button onClick={Transition.start(Model.Amount.update((Value) => Value + 10))}>
      Add ten in a transition
    </button>
  </section>
)

const ImageSection = (Model: ResourcesModel) => (
  <section aria-labelledby="image-title">
    <h3 id="image-title">Native images, preload, and focus</h3>
    <Image.View
      src="/sunrise.svg"
      alt="A pale sun rising behind layered mountain ridges"
      width={960}
      height={540}
      decode
      loading="lazy"
      fallback={<p role="status">The landscape could not be loaded.</p>}
    />
    <p aria-live="polite">Preload status: {Model.PreloadStatus}</p>
    <button onClick={Model.PreloadSunrise}>Preload and decode the image</button>
    <label htmlFor="resource-search">Search</label>
    <input id="resource-search" ref={Model.SearchRef} />
    <button onClick={Focus.focus(Model.SearchRef)}>Focus search field</button>
  </section>
)

const RenderResources = (Model: ResourcesModel) => (
  <section aria-labelledby="resources-title">
    <h2 id="resources-title">Resources and derived state</h2>
    {ProfileSection(Model)}
    {SelectorSection(Model)}
    {ImageSection(Model)}
  </section>
)

export const ResourcesView = Component.local(() =>
  Effect.map(CreateResourcesModel(), RenderResources)
)
