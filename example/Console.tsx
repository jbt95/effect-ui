import {
  Action,
  Async,
  Component,
  Element,
  ErrorBoundary,
  For,
  Form,
  Link,
  Navigation,
  Resource,
  ResourceCache,
  Route,
  Router,
  Signal,
  VirtualList
} from "@effect/ui"
import { Context, Data, Effect, Layer } from "effect"

export interface Member {
  readonly id: string
  readonly name: string
  readonly team: string
  readonly oncall: boolean
}

export interface ActivityEvent {
  readonly id: number
  readonly text: string
}

export interface AuditEntry {
  readonly id: string
  readonly text: string
}

export class UnknownMember extends Data.TaggedError("UnknownMember")<{ readonly id: string }> {}

const InitialMembers: ReadonlyArray<Member> = [
  { id: "ada", name: "Ada Lovelace", team: "Core", oncall: true },
  { id: "grace", name: "Grace Hopper", team: "Core", oncall: false },
  { id: "alan", name: "Alan Turing", team: "Crypto", oncall: false },
  { id: "katherine", name: "Katherine Johnson", team: "Flight", oncall: true },
  { id: "margaret", name: "Margaret Hamilton", team: "Flight", oncall: false },
  { id: "barbara", name: "Barbara Liskov", team: "Core", oncall: false },
  { id: "edsger", name: "Edsger Dijkstra", team: "Crypto", oncall: false },
  { id: "don", name: "Don Knuth", team: "Crypto", oncall: false },
  { id: "radia", name: "Radia Perlman", team: "Network", oncall: true },
  { id: "hedy", name: "Hedy Lamarr", team: "Network", oncall: false },
  { id: "sophie", name: "Sophie Wilson", team: "Flight", oncall: false },
  { id: "lynn", name: "Lynn Conway", team: "Core", oncall: false }
]

const AuditEntries: ReadonlyArray<AuditEntry> = Array.from({ length: 1500 }, (_, index) => ({
  id: `audit-${index + 1}`,
  text: `Audit event ${index + 1}: deploy check passed`
}))

/** Signed-in user. The writable name is shared state; rename is a closed action. */
export class Session extends Context.Service<
  Session,
  {
    readonly displayName: Signal.Writable<string>
    readonly role: string
    readonly rename: (name: string) => Effect.Effect<void>
  }
>()("console/Session") {
  static readonly layer = Layer.effect(
    Session,
    Effect.gen(function* () {
      const displayName = yield* Signal.make("Ada Lovelace")

      return Session.of({ displayName, role: "Owner", rename: (name) => displayName.set(name) })
    })
  )
}

/** In-memory directory behind a service seam, so demos and tests share behavior. */
export class DirectoryApi extends Context.Service<
  DirectoryApi,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Member>>
    readonly get: (id: string) => Effect.Effect<Member, UnknownMember>
    readonly setOncall: (id: string, oncall: boolean) => Effect.Effect<Member, UnknownMember>
  }
>()("console/Directory") {
  static readonly layer = Layer.effect(
    DirectoryApi,
    Effect.gen(function* () {
      const store = yield* Signal.make(InitialMembers)

      const find = (id: string): Member | undefined => store.value.find((m) => m.id === id)

      return DirectoryApi.of({
        list: () => Effect.succeed(store.value),
        get: (id) => {
          const member = find(id)

          return member === undefined
            ? Effect.fail(new UnknownMember({ id }))
            : Effect.succeed(member)
        },
        setOncall: (id, oncall) =>
          Effect.gen(function* () {
            const current = find(id)

            if (current === undefined) return yield* Effect.fail(new UnknownMember({ id }))

            const next = { ...current, oncall }
            yield* store.update((all) => all.map((m) => (m.id === id ? next : m)))

            return next
          })
      })
    })
  )
}

/** Append-only activity log; the virtualized audit trail stays a static snapshot. */
export class Activity extends Context.Service<
  Activity,
  {
    readonly events: Signal.Source<ReadonlyArray<ActivityEvent>>
    readonly record: (text: string) => Effect.Effect<void>
  }
>()("console/Activity") {
  static readonly layer = Layer.effect(
    Activity,
    Effect.gen(function* () {
      let nextId = 1
      const events = yield* Signal.make<ReadonlyArray<ActivityEvent>>([])

      return Activity.of({
        events,
        record: (text) => events.update((all) => [...all.slice(-49), { id: nextId++, text }])
      })
    })
  )
}

const MembersQuery = ResourceCache.key<undefined, ReadonlyArray<Member>, never, DirectoryApi>(
  "console-members",
  {
    identify: () => "all",
    load: () => DirectoryApi.use((api) => api.list()),
    staleTime: "1 minute"
  }
)

const MemberQuery = ResourceCache.key("console-member", {
  identify: (id: string) => id,
  load: (id) => DirectoryApi.use((api) => api.get(id))
})

type AnchorTag = Component.Component<Link.Props>

interface ConsoleDeps {
  readonly sessionName: Signal.Source<string>
  readonly sessionRole: string
  readonly renameSession: (name: string) => Effect.Effect<void>
  readonly recordActivity: (text: string) => Effect.Effect<void>
  readonly activityEvents: Signal.Source<ReadonlyArray<ActivityEvent>>
  readonly lookupMembers: (
    args: undefined
  ) => Effect.Effect<Resource.Resource<ReadonlyArray<Member>, never>>
  readonly lookupMember: (id: string) => Effect.Effect<Resource.Resource<Member, UnknownMember>>
  readonly setOncall: (id: string, oncall: boolean) => Effect.Effect<void, UnknownMember>
  readonly goOverview: Effect.Effect<void, Navigation.NavigationError>
  readonly Anchor: AnchorTag
}

const Shell = (deps: ConsoleDeps) => {
  const Anchor = deps.Anchor

  return Component.sync((props: { readonly children?: Element.ElementChild }) => (
    <div>
      <header>
        <h2>Operations console</h2>
        <p>
          Signed in as {deps.sessionName} ({deps.sessionRole})
        </p>
        <nav aria-label="Console sections">
          <Anchor to="/console" end>
            Overview
          </Anchor>{" "}
          | <Anchor to="/console/users">Members</Anchor> |{" "}
          <Anchor to="/console/activity">Audit</Anchor> |{" "}
          <Anchor to="/console/settings">Settings</Anchor>
        </nav>
      </header>
      {props.children}
      <aside aria-labelledby="console-activity-title">
        <h3 id="console-activity-title">Recent activity</h3>
        <LiveTail events={deps.activityEvents} />
      </aside>
    </div>
  ))
}

const LiveTail = Component.local((props: { readonly events: ConsoleDeps["activityEvents"] }) =>
  Effect.gen(function* () {
    const tail = yield* Signal.memo([props.events], () => props.events.value.slice(-5))

    return (
      <ul>
        <For.View each={tail} keyOf={(event) => event.id}>
          {(event: ActivityEvent) => <li>{event.text}</li>}
        </For.View>
      </ul>
    )
  })
)

const OverviewPage = (deps: ConsoleDeps) => {
  const Anchor = deps.Anchor

  return Component.local(() =>
    Effect.gen(function* () {
      const members = yield* deps.lookupMembers(undefined)
      const refresh = members.refresh.pipe(Effect.andThen(deps.recordActivity("Members refreshed")))

      return (
        <section aria-labelledby="console-overview-title">
          <h3 id="console-overview-title">Overview</h3>
          <Async.View
            source={members}
            pending={<p role="status">Loading members…</p>}
            success={(all) => (
              <>
                <p>
                  {all.length} members, {all.filter((m) => m.oncall).length} on call.
                </p>
                <p>
                  <Anchor to="/console/users">Open the member directory</Anchor>
                </p>
              </>
            )}
          />
          <button onClick={refresh}>Refresh members</button>
        </section>
      )
    })
  )
}

const UsersList = Component.local(
  (props: { readonly members: ReadonlyArray<Member>; readonly Anchor: AnchorTag }) =>
    Effect.gen(function* () {
      const query = yield* Signal.make("")

      const filtered = yield* Signal.memo([query], () =>
        props.members.filter((m) => m.name.toLowerCase().includes(query.value.toLowerCase()))
      )

      const Anchor = props.Anchor

      return (
        <>
          <label htmlFor="console-member-search">Search members</label>
          <input
            id="console-member-search"
            value={query}
            onInput={(event) => query.set(event.currentTarget.value)}
          />
          <ul>
            <For.View each={filtered} keyOf={(m) => m.id}>
              {(member: Member) => (
                <li>
                  <Anchor to={`/console/users/${member.id}`}>{member.name}</Anchor>{" "}
                  <span>{member.oncall ? "On call" : "Off duty"}</span>
                </li>
              )}
            </For.View>
          </ul>
        </>
      )
    })
)

const UsersPage = (deps: ConsoleDeps) => {
  const Anchor = deps.Anchor

  return Component.local(() =>
    Effect.gen(function* () {
      const members = yield* deps.lookupMembers(undefined)

      return (
        <section aria-labelledby="console-users-title">
          <h3 id="console-users-title">Members</h3>
          <Async.View
            source={members}
            pending={<p role="status">Loading members…</p>}
            success={(all) => <UsersList members={all} Anchor={Anchor} />}
          />
        </section>
      )
    })
  )
}

const MemberDetail = (
  deps: ConsoleDeps,
  resource: Resource.Resource<Member, UnknownMember>,
  member: Member
) => {
  const Anchor = deps.Anchor

  const toggle = deps
    .setOncall(member.id, !member.oncall)
    .pipe(Effect.andThen(Resource.refresh(resource)))

  return (
    <article aria-labelledby="console-member-title">
      <h3 id="console-member-title">{member.name}</h3>
      <p>Team: {member.team}</p>
      <p>Status: {member.oncall ? "On call" : "Off duty"}</p>
      <button onClick={toggle}>{member.oncall ? "Clear on-call" : "Set on-call"}</button>{" "}
      <button onClick={Resource.refresh(resource)}>Refresh member</button>
      <p>
        <Anchor to="/console/users">Back to members</Anchor>
      </p>
    </article>
  )
}

const MemberPage = (deps: ConsoleDeps) => {
  const Anchor = deps.Anchor

  return Component.local((props: { readonly id: string }) =>
    Effect.gen(function* () {
      const member = yield* deps.lookupMember(props.id)

      return (
        <Async.View
          source={member}
          pending={<p role="status">Loading member…</p>}
          success={(value) => MemberDetail(deps, member, value)}
          failure={() => (
            <p role="alert">
              Unknown member “{props.id}”. <Anchor to="/console/users">Back to members</Anchor>
            </p>
          )}
        />
      )
    })
  )
}

const AuditViewport = (audit: VirtualList.VirtualList<AuditEntry>) => (
  <section aria-labelledby="console-audit-title">
    <h3 id="console-audit-title">Audit trail</h3>
    <div
      {...audit.attributes}
      style={{ height: "240px", overflowY: "auto", position: "relative" }}
      onScroll={(event) => audit.onScroll(event.currentTarget.scrollTop)}
    >
      <div style={{ height: `${audit.totalSize}px`, position: "relative" }}>
        <For.View each={audit.rows} keyOf={(row) => row.key}>
          {(row) => (
            <div
              {...audit.optionAttributes(row)}
              onClick={audit.setActive(row.index)}
              style={{ position: "absolute", top: `${row.start}px`, height: "36px" }}
            >
              {row.item.text}
            </div>
          )}
        </For.View>
      </div>
    </div>
  </section>
)

const AuditPage = () =>
  Component.local(() =>
    Effect.gen(function* () {
      const audit = yield* VirtualList.make({
        id: "console-audit",
        ariaLabel: "Audit trail",
        items: AuditEntries,
        keyOf: (entry) => entry.id,
        itemSize: 36,
        viewportSize: 240,
        overscan: 4
      })

      return AuditViewport(audit)
    })
  )

interface SettingsValues {
  readonly displayName: string
  readonly team: string
}

const SettingsForm = (
  form: Form.FormState<SettingsValues, string, never, Navigation.NavigationError>,
  name: Form.FormField<string>,
  team: Form.FormField<string>,
  issues: Signal.Source<string>
) => (
  <section aria-labelledby="console-settings-title">
    <h3 id="console-settings-title">Settings</h3>
    <form onSubmit={form.onSubmit}>
      <label htmlFor="console-display-name">Display name</label>
      <input
        id="console-display-name"
        value={name.value}
        onInput={(event) => name.set(event.currentTarget.value)}
      />
      <label htmlFor="console-team">Team</label>
      <input
        id="console-team"
        value={team.value}
        onInput={(event) => team.set(event.currentTarget.value)}
      />
      <p role="alert">{issues}</p>
      <button type="submit" disabled={form.submitting}>
        Save settings
      </button>
    </form>
  </section>
)

const SettingsPage = (deps: ConsoleDeps) =>
  Component.local(() =>
    Effect.gen(function* () {
      const form = yield* Form.make({
        initial: { displayName: deps.sessionName.value, team: "Core" },
        validate: ({ displayName }: SettingsValues) =>
          Effect.succeed(displayName.trim().length === 0 ? ["Enter a display name"] : []),
        onSubmit: (values: SettingsValues) =>
          deps
            .renameSession(values.displayName)
            .pipe(
              Effect.andThen(
                deps.recordActivity(`Profile updated to ${values.displayName} (${values.team})`)
              ),
              Effect.andThen(deps.goOverview)
            )
      })

      const name = yield* Form.field(form.values, "displayName")
      const team = yield* Form.field(form.values, "team")
      const issues = yield* Signal.map(form.errors, (list) => list.join(" "))

      return SettingsForm(form, name, team, issues)
    })
  )

const buildSetOncall =
  (
    update: (id: string, oncall: boolean) => Effect.Effect<Member, UnknownMember>,
    record: (text: string) => Effect.Effect<void>
  ) =>
  (id: string, oncall: boolean) =>
    update(id, oncall)
      .pipe(Effect.andThen(record(`Member ${id} on-call ${oncall ? "enabled" : "cleared"}`)))
      .pipe(Effect.asVoid)

const acquireConsoleDeps = Effect.gen(function* () {
  const session = yield* Session
  const api = yield* DirectoryApi
  const activity = yield* Activity
  const Anchor = yield* Link.make()

  const lookups = yield* Effect.all({
    members: ResourceCache.bind(MembersQuery),
    member: ResourceCache.bind(MemberQuery)
  })

  const goOverview = yield* Action.bind(Navigation.navigate("/console"))
  const setOncall = buildSetOncall(api.setOncall, activity.record)

  return {
    sessionName: session.displayName,
    sessionRole: session.role,
    renameSession: session.rename,
    recordActivity: activity.record,
    activityEvents: activity.events,
    lookupMembers: lookups.members,
    lookupMember: lookups.member,
    setOncall,
    goOverview,
    Anchor
  } satisfies ConsoleDeps
})

interface ConsolePages {
  readonly Overview: Component.Component
  readonly Users: Component.Component
  readonly Member: Component.Component<{ readonly id: string }>
  readonly Audit: Component.Component
  readonly Settings: Component.Component
  readonly ShellTag: Component.Component<{ readonly children?: Element.ElementChild }>
}

const userDetailRoute = (Member: ConsolePages["Member"]): Router.RouteDefinition =>
  Route.make("users/:id", {
    metadata: ({ params }) => ({ title: `Member ${params.id} — Console` }),
    render: ({ params }) => <Member id={params.id} />
  })

const consoleChildren = (pages: ConsolePages): ReadonlyArray<Router.RouteDefinition> => {
  const { Users, Member, Audit, Settings } = pages

  return [
    Route.make("users", { render: () => <Users /> }),
    userDetailRoute(Member),
    Route.make("activity", { render: () => <Audit /> }),
    Route.make("settings", { render: () => <Settings /> })
  ]
}

const consoleParent = (pages: ConsolePages): Router.RouteDefinition => {
  const { Overview, ShellTag } = pages

  return Route.make("/console", {
    metadata: {
      title: "Console — @effect/ui",
      description: "Operations console overview."
    },
    layout: (_location, child) => (
      <ErrorBoundary.View fallback={<p role="alert">The console failed to render.</p>}>
        <ShellTag>{child}</ShellTag>
      </ErrorBoundary.View>
    ),
    render: () => <Overview />,
    children: consoleChildren(pages),
    notFound: <p role="status">Console page not found.</p>
  })
}

const assembleConsoleOutlet = (deps: ConsoleDeps) =>
  Effect.gen(function* () {
    const pages: ConsolePages = {
      Overview: OverviewPage(deps),
      Users: UsersPage(deps),
      Member: MemberPage(deps),
      Audit: AuditPage(),
      Settings: SettingsPage(deps),
      ShellTag: Shell(deps)
    }

    return yield* Router.make({
      routes: [consoleParent(pages)],
      notFound: <p role="status">Console page not found.</p>
    })
  })

/** Integrated console: routing, cached queries, forms, virtualization, and activity. */
export const ConsoleView = Component.make(
  Effect.gen(function* () {
    const deps = yield* acquireConsoleDeps
    const Outlet = yield* assembleConsoleOutlet(deps)

    return () => Effect.succeed(<Outlet />)
  })
)
