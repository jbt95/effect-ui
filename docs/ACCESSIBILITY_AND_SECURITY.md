# Accessibility and security guidance

## Accessibility

- Prefer semantic native HTML: buttons for actions, anchors for navigation, and
  labels associated with form controls via `htmlFor`/`id`.
- Preserve browser keyboard behavior. Native event callbacks receive typed DOM
  events; native default behavior is not canceled unless application code or a
  helper such as the form `onSubmit` explicitly cancels it.
- `Link` keeps a real `href`, sets `aria-current="page"` for exact matches, and
  exposes prefix activity through `data-active`. Add visible active styling and
  do not use color alone to communicate state.
- Use `focus`, `blur`, and `focusFirst` for deliberate focus movement. The
  library does not create focus traps, dialog semantics, or automatic focus
  restoration; implement and test those behaviors for the relevant widget.
- Use `ErrorBoundary` and form errors with clear, actionable text. Add
  `role="alert"` or a live region only when the update should be announced.
- Test keyboard use, zoom, reduced motion, contrast, screen-reader output, and
  mobile input behavior in the application, not only in unit tests.

## Security

- Text children are created as text nodes. JSX does not expose `innerHTML`,
  `outerHTML`, `textContent`, or iframe `srcdoc` sinks.
- Script elements and SVG animation elements are rejected. Unknown event-like
  `on*` props are never serialized as attributes.
- URL-bearing attributes reject `javascript:` and `vbscript:` schemes after
  stripping parser-ignored control characters. `srcset` candidates are checked
  separately. Client-side `Navigate` and `Link` only intercept same-origin
  navigation; cross-origin anchors retain browser behavior.
- These checks are defense in depth, not a universal sanitizer. Avoid
  interpolating untrusted input into CSS, custom-element behavior, URLs, or
  application-defined parsing. Validate user input at the application and
  service boundaries; do not treat `ErrorBoundary` as an authorization or
  confidentiality boundary.
- Avoid rendering secrets in error messages or route fallback content. Apply a
  restrictive Content Security Policy and other deployment headers at the
  server/CDN layer.
