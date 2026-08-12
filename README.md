# restwire

A `fetch` interceptor chain and a small REST client, in ~250 lines with no dependencies.

Two pieces that compose:

- **`createFetch`** — wraps a transport in a middleware chain. Interceptors add headers, count in-flight
  requests, retry a 401, or short-circuit from a cache. Everything is still a plain `fetch`.
- **`rest`** — binds one endpoint to a set of verbs. Builds urls, serialises the body by its type, parses
  the response, throws `RestError` on a non-2xx.

Nothing in here imports a framework, touches `window`, or reads a global. It runs unchanged in the browser,
under SSR, and in a worker.

```sh
npm i restwire   # bun add restwire
```

## The REST client

```ts
import { rest } from 'restwire'

const products = rest('https://api.example.com/products')

await products.query({ params: { fields: 'FULL', pageSize: 20 } }) // GET /products?fields=FULL&pageSize=20
await products.get('123') // GET /products/123
await products.post({ name: 'Widget' }) // POST /products
await products.put('123', { name: 'Widget 2' }) // PUT /products/123
await products.delete('123') // DELETE /products/123
```

`id` is any path suffix, not only a bare identifier — `get('123/references')` and
`postAt('sessions/abc/checkout', body)` both work, so one client covers a subtree.

### The endpoint can be a thunk

Pass a function and it is read at call time. A client built once at startup still follows a base url that
depends on the current site, locale or signed-in user:

```ts
const carts = rest(() => `${config.baseUrl}/${site}/users/${userId}/carts`, api.fetch)
```

### Bodies serialise by type

| You pass | Sent as | `Content-Type` |
| --- | --- | --- |
| plain object / array | `JSON.stringify` | `application/json` |
| `URLSearchParams` | `toString()` | `application/x-www-form-urlencoded` |
| `FormData` | as-is | *none* — the transport adds the multipart boundary |
| `Blob` / `ArrayBuffer` | as-is | *none* |
| `string` | as-is | *none* — set it yourself |

Two helpers ride along on the client for the endpoints that want a form rather than json:

```ts
await roles.postAt(`${groupId}/members`, roles.toUrlForm({ customerId })) // falsy values dropped
await uploads.post(uploads.toFormData({ nested: { id: 5 }, file })) // → nested.id=5, file kept whole
```

`toFormData` flattens nested objects to dotted keys and array items to `list[0].id`. `File`, `Blob` and
`Date` survive whole — `Date` as an ISO string.

### Responses

The `content-type` decides by default: json is parsed, anything else comes back as text. A `204` resolves
`undefined`. Override with `responseType`:

```ts
await attachments.get('a1', { responseType: 'blob' }) // Blob
await punchout.post(cxml, { responseType: 'document' }) // the raw text
```

`'document'` returns **text, not a DOM** — `DOMParser` is browser-only and this runs under SSR too, so
parsing is yours to do.

### Errors

A non-2xx rejects with a `RestError`. It is a real `Error` (stack, logs as one), and it is the only way to
tell the three failure cases apart in a `catch`:

```ts
import { RestError } from 'restwire'

try {
  await carts.postAt(`${cartId}/vouchers`, voucher)
} catch (e) {
  if (!(e instanceof RestError)) throw e // the request never got a response, or your handler threw
  if (e.status === 409) return // already applied
  message = e.body?.errors?.map(x => x.message).join(', ')
}
```

`e.body` is parsed when the response was json, the raw text otherwise, `undefined` when it was empty.
`e.url` is the url *this client built*, query string included — not `response.url`, which a redirect would
have rewritten.

Anything that is not a `RestError` means the server never answered. Rethrow it rather than swallowing it.

## The interceptor chain

```ts
import { createFetch, rest } from 'restwire'

const api = createFetch() // or createFetch(someOtherFetch)

api.use(next => (input, init) => next(input, api.withHeader(init, 'x-site', siteId)))

const products = rest('/api/products', api.fetch)
```

First registered ends up **outermost** — it sees the request first and the response last, so registration
order is the order you read them in.

`api.fetch` is a **stable reference**: the chain is composed per call, so a consumer can capture it before
any interceptor has registered and still see every one of them. That is what makes a resource file safe to
import at module scope while auth wires itself up later.

An interceptor is just a function `next => (input, init) => Response`, so the three interesting shapes fall
out of ordinary control flow:

```ts
// short-circuit — never calls the transport
api.use(() => async input => cache.get(api.toUrl(input)) ?? next(input))

// retry — calls next twice
api.use(next => async (input, init) => {
  const response = await next(input, init)
  return (response.status === 401 && (await refresh()) && next(input, init)) || response
})

// observe — a try/finally around the rest of the chain
api.use(next => async (input, init) => {
  pending++
  try {
    return await next(input, init)
  } finally {
    pending--
  }
})
```

Two helpers hang off the client so an interceptor needs no second import:

- **`api.withHeader(init, name, value)`** — returns a **copy** of `init` with one more header. Never mutate
  the `init` you were handed: it belongs to the caller, and the same object is reused across a retry.
- **`api.toUrl(input)`** — the url whichever of the three forms it arrived in. A `Request` stringifies to
  `'[object Request]'`, so you cannot template it.

## `FetchClient` as a DI token

`FetchClient` is an abstract class rather than an interface so it can double as a dependency-injection key
in containers that key on the class. Subclass it with an empty body when an app needs two independent
clients — they must not resolve to each other:

```ts
export abstract class ApiFetch extends FetchClient {}
export abstract class PaymentsFetch extends FetchClient {}

const useApiFetch = () => inject(ApiFetch, () => createFetch(oauthFetch))
```

If you don't use DI, ignore it — `createFetch()` returns a plain object.

## Utilities

`flatten` and `isObject` are exported because `toFormData` needs them and they are useful on their own:

```ts
import { flatten } from 'restwire'

flatten({ user: { name: 'x' }, tags: ['a'] }) // { 'user.name': 'x', 'tags[0]': 'a' }
flatten({ upload: file }, [File]) // { upload: file } — excluded types kept whole
```

## API

| Export | What |
| --- | --- |
| `createFetch(base?)` | build a `FetchClient` over a transport; defaults to global `fetch` |
| `rest(endpoint, doFetch?)` | build a `RestClient` bound to one endpoint |
| `RestError` | thrown on a non-2xx; `status`, `statusText`, `url`, `body` |
| `flatten`, `isObject` | object helpers |
| `FetchClient`, `FetchInterceptor`, `RestClient`, `RequestOptions`, `HttpResponseType` | types |

## Requirements

`fetch`, `Response`, `Headers`, `FormData`, `File`, `Blob` and `URLSearchParams` as globals — Node 22+, Bun,
Deno, or any current browser. No polyfills, no dependencies, ESM and CJS both shipped.

Nothing is imported from `node:*`, so the package is not Node-specific; the floor is only where those
globals became available unflagged. Node 20 would work too, but it is past end-of-life.

## Development

```sh
bun install
bun run test        # vitest
bun run type-check  # tsc --noEmit
bun run lint        # biome check --write .
bun run build       # tsdown → dist (esm + cjs + dts), validated by publint and attw
bun run check       # lint + type-check + test
```

## Licence

MIT
