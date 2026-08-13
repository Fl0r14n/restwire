# fetch-braid

A `fetch` interceptor chain and a small REST client, in ~250 lines with no dependencies.

- **`createFetch`** braids middleware around a transport — add headers, retry, count in-flight requests.
- **`rest`** binds one endpoint to a set of verbs, serialises the body, parses the response, throws on non-2xx.

No framework, no globals, no `window`. Runs unchanged in the browser, under SSR, and in a worker.

```sh
npm i fetch-braid   # bun add fetch-braid
```

## createFetch

Every interceptor is a strand wrapped around the transport:

```ts
import { createFetch } from 'fetch-braid'

const api = createFetch() // or createFetch(someOtherFetch)
api.use(next => (input, init) => next(input, api.withHeader(init, 'authorization', token)))

await api.fetch('/api/products/123')
```

First registered ends up **outermost**, so registration order is reading order. `api.fetch` is a stable
reference — the chain is composed per call, so a consumer can capture it before any interceptor exists and
still see them all. That's what makes a module-scope resource safe while auth wires itself up later.

An interceptor is just `next => (input, init) => Response`, so skipping `next` short-circuits and calling it
twice retries:

```ts
api.use(next => async (input, init) => {
  const response = await next(input, init)
  return (response.status === 401 && (await refresh()) && next(input, init)) || response
})
```

Two helpers hang off the client so an interceptor needs no second import:

- **`api.withHeader(init, name, value)`** returns a **copy** with one more header. Never mutate the `init`
  you were handed — it belongs to the caller and is reused across a retry.
- **`api.toUrl(input)`** gets the url whichever of the three forms it arrived in. A `Request` stringifies to
  `'[object Request]'`, so you cannot template it.

Both are plain exports too — `import { toUrl, withHeader } from 'fetch-braid'`. Reach for those when the
chain is composed somewhere other than `createFetch`: an Angular app wiring interceptors through DI
multi-providers still wants the helpers, and shouldn't have to build a throwaway client to get at them.
`toUrlForm` and `toFormData` are exported the same way.

### As a DI token

`FetchClient` is an abstract class, not an interface, so it can double as a dependency-injection key.
Subclass it with an empty body when an app needs two independent clients:

```ts
export abstract class ApiFetch extends FetchClient {}
export abstract class PaymentsFetch extends FetchClient {}
```

Not using DI? Ignore it — `createFetch()` returns a plain object.

## rest

Hand it the braided transport, or nothing at all and it uses global `fetch`:

```ts
import { rest } from 'fetch-braid'

const products = rest('https://api.example.com/products', api.fetch)

await products.query({ params: { page: 2, sort: 'name' } }) // GET /products?page=2&sort=name
await products.get('123') // GET /products/123
await products.post({ name: 'Widget' }) // POST /products
await products.postAt('123/publish', {}) // POST /products/123/publish
await products.put('123', { name: 'Widget 2' }) // PUT /products/123
await products.patch('123', { name: 'Widget 3' }) // PATCH /products/123
await products.delete('123') // DELETE /products/123
await products.head('123') // HEAD — resolves undefined, for the status alone
```

`id` is any path suffix, so one client covers a subtree.

Pass a **function** as the endpoint and it is read at call time — a client built once at startup still
follows a base url that depends on the current locale, tenant or signed-in user:

```ts
const orders = rest(() => `${config.baseUrl}/${locale}/users/${userId}/orders`, api.fetch)
```

### Bodies

Serialisation follows the value you pass:

| Value | Sent as | `Content-Type` |
| --- | --- | --- |
| object / array | `JSON.stringify` | `application/json` |
| `URLSearchParams` | `toString()` | `application/x-www-form-urlencoded` |
| `FormData` | as-is | *none* — the transport adds the multipart boundary |
| `Blob` / `ArrayBuffer` | as-is | *none* |
| `string` | as-is | *none* — set it yourself |

Two helpers ride along for endpoints that want a form rather than json:

```ts
await groups.postAt(`${id}/members`, groups.toUrlForm({ userId })) // falsy values dropped
await uploads.post(uploads.toFormData({ meta: { id: 5 }, file })) // → meta.id=5, file kept whole
```

`toFormData` flattens nested objects to dotted keys and array items to `list[0].id`. `File`, `Blob` and
`Date` survive whole, `Date` as an ISO string.

### Responses

The `content-type` decides by default — json is parsed, anything else is text, `204` resolves `undefined`.
Override with `responseType`:

```ts
await files.get('a1', { responseType: 'blob' }) // Blob
await feed.get('a1', { responseType: 'document' }) // the raw text, NOT a DOM
```

`'document'` returns text because `DOMParser` is browser-only and this runs under SSR too.

### Errors

A non-2xx rejects with a `RestError` — a real `Error`, and the only way to tell the failure cases apart:

```ts
import { RestError } from 'fetch-braid'

try {
  await orders.post(order)
} catch (e) {
  if (!(e instanceof RestError)) throw e // never got a response, or your handler threw
  if (e.status === 409) return // already exists
  message = e.body?.errors?.map(x => x.message).join(', ')
}
```

`e.body` is parsed json, or raw text, or `undefined` when empty. `e.url` is the url *this client built*,
query string included — not `response.url`, which a redirect would have rewritten.

## API

| Export | What |
| --- | --- |
| `createFetch(base?)` | a `FetchClient` over a transport; defaults to global `fetch` |
| `rest(endpoint, doFetch?)` | a `RestClient` bound to one endpoint |
| `RestError` | thrown on non-2xx; `status`, `statusText`, `url`, `body` |
| `toUrl`, `withHeader` | the interceptor helpers, standalone as well as on the client |
| `toUrlForm`, `toFormData` | the body helpers, standalone as well as on the client |
| `flatten`, `isObject` | object helpers, exported because `toFormData` needs them |
| `FetchClient`, `FetchInterceptor`, `RestClient`, `RequestOptions`, `HttpResponseType` | types |

## Requirements

`fetch`, `Response`, `Headers`, `FormData`, `File`, `Blob` and `URLSearchParams` as globals — Node 22+, Bun,
Deno, or any current browser. Nothing is imported from `node:*`. ESM and CJS both shipped.

## Development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

## Licence

MIT
