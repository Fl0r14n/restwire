import { describe, expect, it, vi } from 'vitest'
import { RestError, rest, toFormData, toUrlForm } from './rest'

const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

const mockFetch = (respond: () => Response = () => json('ok')) => vi.fn(async () => respond()) as unknown as typeof fetch

// urls/bodies are what matter; the init arg carries method, body and headers
const url = (fn: any, call = 0) => fn.mock.calls[call][0] as string
const init = (fn: any, call = 0) => fn.mock.calls[call][1] as RequestInit
const method = (fn: any, call = 0) => init(fn, call).method

describe('rest verbs', () => {
  it('query GETs the bare endpoint and unwraps the json body', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    expect(await client.query()).toBe('ok')
    expect(url(doFetch)).toBe('/base/products')
    expect(method(doFetch)).toBe('GET')
  })

  it('get appends the id to the endpoint', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    await client.get('123')
    expect(url(doFetch)).toBe('/base/products/123')
  })

  it('post serialises the body as json and sets the content type', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/carts', doFetch)
    await client.post({ qty: 1 })
    expect(url(doFetch)).toBe('/base/carts')
    expect(method(doFetch)).toBe('POST')
    expect(init(doFetch).body).toBe('{"qty":1}')
    expect(new Headers(init(doFetch).headers).get('Content-Type')).toBe('application/json')
  })

  it('postAt targets a member of the endpoint', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/carts', doFetch)
    await client.postAt('c1/vouchers', { code: 'X' })
    expect(url(doFetch)).toBe('/base/carts/c1/vouchers')
    expect(method(doFetch)).toBe('POST')
  })

  it('put / patch / delete target the id path', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/carts', doFetch)
    await client.put('c1', { a: 1 })
    await client.patch('c1', { a: 2 })
    await client.delete('c1')
    expect(url(doFetch, 0)).toBe('/base/carts/c1')
    expect(method(doFetch, 0)).toBe('PUT')
    expect(init(doFetch, 0).body).toBe('{"a":1}')
    expect(method(doFetch, 1)).toBe('PATCH')
    expect(method(doFetch, 2)).toBe('DELETE')
  })

  it('head resolves undefined even when the server sent a body', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    expect(await client.head('123')).toBeUndefined()
    expect(method(doFetch)).toBe('HEAD')
  })

  it('reads the endpoint thunk at call time, so a client follows changing context', async () => {
    const doFetch = mockFetch()
    let endpoint = '/base/a'
    const client = rest(() => endpoint, doFetch)
    endpoint = '/base/b'
    await client.query()
    expect(url(doFetch)).toBe('/base/b')
  })

  it('serialises array params into the query string, dropping undefined entries', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    await client.query({ params: { code: ['a', 'b', undefined], fields: 'FULL' } })
    const params = new URL(url(doFetch), 'http://x').searchParams
    expect(params.getAll('code')).toEqual(['a', 'b'])
    expect(params.get('fields')).toBe('FULL')
  })

  it('drops undefined scalar params rather than sending the string "undefined"', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    await client.query({ params: { q: undefined, page: 0 } })
    expect(url(doFetch)).toBe('/base/products?page=0')
  })

  it('does not send a body or a query string when there are none', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/products', doFetch)
    await client.query()
    expect(url(doFetch)).toBe('/base/products')
    expect(init(doFetch).body).toBeUndefined()
  })

  it('leaves Content-Type off FormData so the transport sets the boundary', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/uploads', doFetch)
    const form = new FormData()
    form.append('file', new File(['x'], 'x.txt'))
    await client.post(form)
    expect(init(doFetch).body).toBeInstanceOf(FormData)
    expect(new Headers(init(doFetch).headers).has('Content-Type')).toBe(false)
  })

  it('sends URLSearchParams as urlencoded', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/roles', doFetch)
    await client.post(new URLSearchParams({ roleId: 'admin' }))
    expect(init(doFetch).body).toBe('roleId=admin')
    expect(new Headers(init(doFetch).headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
  })

  it('sends a string body as-is, with no Content-Type of its own', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/punchout', doFetch)
    await client.post('<cXML/>', { headers: { 'Content-Type': 'text/xml' } })
    expect(init(doFetch).body).toBe('<cXML/>')
    expect(new Headers(init(doFetch).headers).get('Content-Type')).toBe('text/xml')
  })

  it('an explicit undefined header clears a default', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/x', doFetch)
    await client.post({ a: 1 }, { headers: { 'X-Thing': undefined } })
    expect(new Headers(init(doFetch).headers).has('X-Thing')).toBe(false)
  })

  it('passes RequestInit fields such as credentials through', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/csrf', doFetch)
    await client.query({ credentials: 'include' })
    expect(init(doFetch).credentials).toBe('include')
  })

  it('does not forward unknown options as RequestInit fields', async () => {
    const doFetch = mockFetch()
    const client = rest('/base/x', doFetch)
    await client.query({ responseType: 'json', notAnInitField: 'x' })
    expect((init(doFetch) as any).notAnInitField).toBeUndefined()
    expect((init(doFetch) as any).responseType).toBeUndefined()
  })

  it('returns undefined on 204', async () => {
    const doFetch = mockFetch(() => new Response(null, { status: 204 }))
    const client = rest('/base/carts', doFetch)
    expect(await client.delete('c1')).toBeUndefined()
  })

  it('returns text when the response is not json', async () => {
    const doFetch = mockFetch(() => new Response('<cXML/>', { status: 200, headers: { 'content-type': 'text/xml' } }))
    const client = rest('/base/punchout', doFetch)
    expect(await client.postAt('cxml/order', '<cXML/>', { responseType: 'document' })).toBe('<cXML/>')
  })

  it('returns a Blob for responseType blob', async () => {
    const doFetch = mockFetch(() => new Response('bytes', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const client = rest('/base/attachments', doFetch)
    expect(await client.get('a1', { responseType: 'blob' })).toBeInstanceOf(Blob)
  })

  it('returns an ArrayBuffer for responseType arraybuffer', async () => {
    const doFetch = mockFetch(() => new Response('bytes', { status: 200 }))
    const client = rest('/base/attachments', doFetch)
    expect(await client.get('a1', { responseType: 'arraybuffer' })).toBeInstanceOf(ArrayBuffer)
  })

  it('resolves undefined rather than throwing when a 200 json body is malformed', async () => {
    const doFetch = mockFetch(() => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = rest('/base/x', doFetch)
    expect(await client.query()).toBeUndefined()
  })
})

describe('error mapping', () => {
  const reject = async (respond: () => Response) => {
    const client = rest('/base/carts', mockFetch(respond))
    return await client.get('c1').then(
      () => undefined,
      e => e
    )
  }

  it('rejects with a RestError carrying the parsed body and the status', async () => {
    const e = await reject(() => json({ errors: [{ type: 'CartError' }] }, 400))
    expect(e).toBeInstanceOf(RestError)
    expect(e.status).toBe(400)
    expect(e.body).toEqual({ errors: [{ type: 'CartError' }] })
    expect(e.url).toBe('/base/carts/c1')
  })

  it('is a real Error, so it logs and reports as one', async () => {
    const e = await reject(() => json({}, 404))
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('RestError')
    expect(e.stack).toBeTruthy()
    expect(e.message).toContain('404')
  })

  it('keeps a non-json body as text', async () => {
    const e = await reject(() => new Response('gateway down', { status: 502 }))
    expect(e.body).toBe('gateway down')
    expect(e.status).toBe(502)
  })

  it('leaves body undefined when the response had none', async () => {
    const e = await reject(() => new Response('', { status: 500 }))
    expect(e.body).toBeUndefined()
  })

  it('reports the url this client built, query string included', async () => {
    const doFetch = mockFetch(() => json({}, 400))
    const client = rest('/base/products', doFetch)
    const e: any = await client.query({ params: { fields: 'FULL' } }).catch((err: any) => err)
    expect(e.url).toBe('/base/products?fields=FULL')
  })

  it('a transport failure is not a RestError — the server never answered', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    const client = rest('/base/carts', doFetch)
    await expect(client.get('c1')).rejects.not.toBeInstanceOf(RestError)
  })
})

describe('form helpers', () => {
  it('toUrlForm drops falsy values', () => {
    const client = rest('/x', mockFetch())
    const form = client.toUrlForm({ a: '1', b: '', c: '3' })
    expect(form.get('a')).toBe('1')
    expect(form.has('b')).toBe(false)
    expect(form.get('c')).toBe('3')
  })

  it('toFormData flattens nested objects and keeps files whole', () => {
    const client = rest('/x', mockFetch())
    const file = new File(['x'], 'x.txt')
    const form = client.toFormData({ nested: { id: 5 }, upload: file })
    expect(form.get('nested.id')).toBe('5')
    expect(form.get('upload')).toBeInstanceOf(File)
  })

  it('toFormData serialises Date as ISO string', () => {
    const client = rest('/x', mockFetch())
    const form = client.toFormData({ when: new Date('2026-01-15T00:00:00Z') })
    expect(form.get('when')).toBe('2026-01-15T00:00:00.000Z')
  })

  it('toFormData skips null and undefined entries', () => {
    const client = rest('/x', mockFetch())
    const form = client.toFormData({ a: 1, b: null, c: undefined })
    expect(form.get('a')).toBe('1')
    expect(form.has('b')).toBe(false)
    expect(form.has('c')).toBe(false)
  })

  it('the client carries the same functions the module exports', () => {
    // importable without building a client, and the two must not drift apart
    const client = rest('/x', mockFetch())
    expect(client.toUrlForm).toBe(toUrlForm)
    expect(client.toFormData).toBe(toFormData)
  })
})
