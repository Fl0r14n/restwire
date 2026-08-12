// Exercises the BUILT package on a plain node, no bundler and no vitest transform in the way.
// The unit tests cover behaviour; this only asks whether dist/ is importable and wired up.
import assert from 'node:assert/strict'
import { createFetch, flatten, RestError, rest } from '../dist/index.mjs'

const ok = body => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })

// the interceptor chain composes and can rewrite the request
const api = createFetch(async (input, init) => ok(JSON.stringify({ url: String(input), sent: new Headers(init?.headers).get('x-smoke') })))
api.use(next => (input, init) => next(input, api.withHeader(init, 'x-smoke', 'yes')))

const client = rest('https://example.test/products', api.fetch)
const body = await client.get('123', { params: { fields: 'FULL' } })
assert.equal(body.url, 'https://example.test/products/123?fields=FULL')
assert.equal(body.sent, 'yes')

// a non-2xx becomes a RestError, and the class survives the bundle boundary
const failing = rest('https://example.test/orders', async () => new Response('nope', { status: 409 }))
const error = await failing.get('c1').catch(e => e)
assert.ok(error instanceof RestError, 'expected a RestError instance')
assert.ok(error instanceof Error, 'RestError must remain a real Error')
assert.equal(error.status, 409)
assert.equal(error.body, 'nope')

assert.deepEqual(flatten({ a: { b: 1 } }), { 'a.b': 1 })

console.log(`esm smoke ok on node ${process.version}`)
