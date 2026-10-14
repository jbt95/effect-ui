import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const DistRoot = resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
const Host = process.env.BENCH_HOST ?? "127.0.0.1"
const Port = Number(process.env.BENCH_PORT ?? 4173)

const MimeTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
}

const Server = createServer(async (request, response) => {
  let pathname: string

  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${Host}:${Port}`).pathname)
  } catch {
    response.writeHead(400).end("Bad URL")

    return
  }

  if (pathname.endsWith("/")) pathname += "index.html"

  const filePath = resolve(DistRoot, `.${pathname}`)

  if (filePath !== DistRoot && !filePath.startsWith(`${DistRoot}${sep}`)) {
    response.writeHead(403).end("Forbidden")

    return
  }

  let content: Buffer

  try {
    content = await readFile(filePath)
  } catch {
    response.writeHead(404).end("Not found")

    return
  }

  response
    .writeHead(200, {
      "cache-control": "no-store",
      "content-type": MimeTypes[extname(filePath)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff"
    })
    .end(content)
})

Server.listen(Port, Host, () => {
  console.log(`Serving @effect/ui benchmark app at http://${Host}:${Port}/`)
})
