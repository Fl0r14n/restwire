// The CJS half of the smoke test: `require` must give the same working exports as `import`.
// This is what catches a dual-package build where only one condition actually resolves.
const assert = require('node:assert/strict')
const { createFetch, flatten, rest, RestError } = require('../dist/index.cjs')

const main = async () => {
  const api = createFetch(
    async (input, init) =>
      new Response(JSON.stringify({ url: String(input), sent: new Headers(init?.headers).get('x-smoke') }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  )
  api.use(next => (input, init) => next(input, api.withHeader(init, 'x-smoke', 'yes')))

  const body = await rest('https://example.test/products', api.fetch).get('123', { params: { fields: 'FULL' } })
  assert.equal(body.url, 'https://example.test/products/123?fields=FULL')
  assert.equal(body.sent, 'yes')

  const failing = rest('https://example.test/carts', async () => new Response('nope', { status: 409 }))
  const error = await failing.get('c1').catch(e => e)
  assert.ok(error instanceof RestError, 'expected a RestError instance')
  assert.equal(error.status, 409)

  assert.deepEqual(flatten({ a: { b: 1 } }), { 'a.b': 1 })

  console.log(`cjs smoke ok on node ${process.version}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
