# Browser support and real-browser smoke test

## Support policy

`@effect/ui` is a browser-DOM framework targeting ES2022. The supported matrix
is the current and previous stable release of each evergreen desktop browser:

| Engine   | Browsers                      | Policy                      |
| -------- | ----------------------------- | --------------------------- |
| Chromium | Google Chrome, Microsoft Edge | Current and previous stable |
| Gecko    | Mozilla Firefox               | Current and previous stable |
| WebKit   | Apple Safari on macOS         | Current and previous stable |

Mobile Safari and Chrome are supported when their engine version is within the
same policy. Internet Explorer and browsers without `queueMicrotask`, modern
`EventTarget`, `History`, `InputEvent`, and ES2022 support are not supported.
The project does not claim a browser/version has passed unless it is run in the
real-browser harness below; Happy DOM tests are fast unit/integration checks,
not browser compatibility evidence.

## WebDriver integration smoke test

The browser smoke page covers reactive updates, routed pending/loaded content,
active navigation, focus, and awaited disposal. It uses the W3C WebDriver HTTP
protocol and adds no runtime or test-runner dependency.

1. Start the Vite server in one terminal: `bun run dev -- --host 0.0.0.0`.
2. Start a W3C WebDriver server with the browser under test.
3. Run in another terminal:

   ```bash
   WEBDRIVER_URL=http://127.0.0.1:9515 \
   BROWSER_NAME=chrome \
   BROWSER_APP_URL=http://127.0.0.1:5173/test/browser/ \
   bun run test:browser
   ```

Set `BROWSER_NAME` to the WebDriver capability name (`chrome`, `MicrosoftEdge`,
`firefox`, or `safari`). When the driver runs in a container, set
`BROWSER_APP_URL` to an address reachable from that container. Run the same
smoke test for each engine in the support matrix before a release.
