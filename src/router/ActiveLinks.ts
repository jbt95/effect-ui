export type ActiveLinkUpdater = () => void

const ActiveLinkUpdaters = new Set<ActiveLinkUpdater>()

let LocationListenersInstalled = false

const UpdateActiveLinks = (): void => NotifyActiveLinks()

const installLocationListeners = (): void => {
  if (LocationListenersInstalled) return

  window.addEventListener("popstate", UpdateActiveLinks)
  window.addEventListener("hashchange", UpdateActiveLinks)
  LocationListenersInstalled = true
}

const removeLocationListeners = (): void => {
  if (!LocationListenersInstalled || ActiveLinkUpdaters.size > 0) return

  window.removeEventListener("popstate", UpdateActiveLinks)
  window.removeEventListener("hashchange", UpdateActiveLinks)
  LocationListenersInstalled = false
}

export const RegisterActiveLink = (Update: ActiveLinkUpdater): (() => void) => {
  ActiveLinkUpdaters.add(Update)
  installLocationListeners()
  Update()

  return () => {
    ActiveLinkUpdaters.delete(Update)
    removeLocationListeners()
  }
}

export const NotifyActiveLinks = (): void => {
  for (const Update of Array.from(ActiveLinkUpdaters)) Update()
}
