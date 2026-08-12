import { describe, expect, it, vi } from 'vitest'
import { createFetch, FetchClient } from './fetch'

// module-private, like rest.ts's toUrlForm/toFormData — reachable only through a client
const { toUrl, withHeader } = createFetch()

const ok = (body = 'ok') => new Response(body, { status: 200 })
const base = () => vi.fn(async () => ok()) as unknown as typeof fetch
const headerOf = (fn: any, name: string, call = 0) => new Headers(fn.mock.calls[call][1]?.headers).get(name)

describe('createFetch', () => {
  it('calls the base transport when nothing is registered', async () => {
    const transport = base()
    const { fetch } = createFetch(transport)
    expect(await (await fetch('/x')).text()).toBe('ok')
    expect((transport as any).mock.calls[0][0]).toBe('/x')
  })

  it('applies an interceptor registered after fetch was captured', async () => {
    const transport = base()
    const api = createFetch(transport)
    // a consumer captures the transport at setup; another registers later
    const captured = api.fetch
    api.use(next => (input, init) => next(input, withHeader(init, 'x-late', '1')))
    await captured('/x')
    expect(headerOf(transport, 'x-late')).toBe('1')
  })

  it('runs the first registered interceptor outermost', async () => {
    const order: string[] = []
    const api = createFetch(base())
    api.use(next => (input, init) => {
      order.push('outer')
      return next(input, init)
    })
    api.use(next => (input, init) => {
      order.push('inner')
      return next(input, init)
    })
    await api.fetch('/x')
    expect(order).toEqual(['outer', 'inner'])
  })

  it('lets an interceptor short-circuit without calling the base', async () => {
    const transport = base()
    const api = createFetch(transport)
    api.use(() => async () => ok('cached'))
    expect(await (await api.fetch('/x')).text()).toBe('cached')
    expect((transport as any).mock.calls.length).toBe(0)
  })

  it('lets an interceptor retry by calling next twice', async () => {
    let calls = 0
    const transport = vi.fn(async () => {
      calls++
      return (calls === 1 && new Response('', { status: 401 })) || ok('retried')
    }) as unknown as typeof fetch
    const api = createFetch(transport)
    api.use(next => async (input, init) => {
      const response = await next(input, init)
      return (response.status === 401 && next(input, init)) || response
    })
    expect(await (await api.fetch('/x')).text()).toBe('retried')
    expect(calls).toBe(2)
  })

  it('propagates a rejection through the chain', async () => {
    const transport = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const api = createFetch(transport)
    const seen: string[] = []
    api.use(next => async (input, init) => {
      try {
        return await next(input, init)
      } finally {
        seen.push('finally')
      }
    })
    await expect(api.fetch('/x')).rejects.toThrow('offline')
    expect(seen).toEqual(['finally'])
  })

  it('defaults to global fetch when no base is given', () => {
    expect(typeof createFetch().fetch).toBe('function')
  })
})

describe('FetchClient as a DI token', () => {
  it('gives each empty subclass its own key, so two clients never collide', () => {
    abstract class ApiFetch extends FetchClient {}
    abstract class PaymentsFetch extends FetchClient {}
    // containers key on the class name — same name would mean one client shadowing the other
    expect(new Set([FetchClient.name, ApiFetch.name, PaymentsFetch.name]).size).toBe(3)
  })

  it('a created client satisfies the abstract shape', () => {
    const client: FetchClient = createFetch()
    expect(typeof client.fetch).toBe('function')
    expect(typeof client.use).toBe('function')
  })
})

describe('helpers', () => {
  it('are carried on the client, so an interceptor needs no second import', async () => {
    const transport = base()
    const api = createFetch(transport)
    api.use(next => (input, init) => next(api.toUrl(input), api.withHeader(init, 'x-from-client', '1')))
    await api.fetch(new Request('https://h/x'))
    expect((transport as any).mock.calls[0][0]).toBe('https://h/x')
    expect(headerOf(transport, 'x-from-client')).toBe('1')
  })

  it('toUrl accepts string, URL and Request', () => {
    expect(toUrl('/x')).toBe('/x')
    expect(toUrl(new URL('https://h/x'))).toBe('https://h/x')
    expect(toUrl(new Request('https://h/x'))).toBe('https://h/x')
  })

  it('withHeader copies the init instead of mutating it', () => {
    const init: RequestInit = { method: 'POST', headers: { a: '1' } }
    const next = withHeader(init, 'b', '2')
    expect(next.method).toBe('POST')
    expect(new Headers(next.headers).get('a')).toBe('1')
    expect(new Headers(next.headers).get('b')).toBe('2')
    expect(new Headers(init.headers).has('b')).toBe(false)
  })

  it('withHeader overwrites a header of the same name', () => {
    const next = withHeader({ headers: { authorization: 'old' } }, 'authorization', 'new')
    expect(new Headers(next.headers).get('authorization')).toBe('new')
  })
})
