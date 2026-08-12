/**
 * Wraps the next transport in the chain and returns the wrapper.
 *
 * Call `next` to continue, skip it to short-circuit, call it more than once to retry. Never mutate
 * the `init` you were handed — it belongs to the caller; use {@link FetchClient.withHeader}.
 *
 * @example Add a header
 * ```ts
 * const auth: FetchInterceptor = next => (input, init) => next(input, client.withHeader(init, 'x-token', token))
 * ```
 * @example Retry once on 401
 * ```ts
 * const retry: FetchInterceptor = next => async (input, init) => {
 *   const response = await next(input, init)
 *   return (response.status === 401 && next(input, init)) || response
 * }
 * ```
 */
export type FetchInterceptor = (next: typeof fetch) => typeof fetch

/**
 * A `fetch` with an interceptor chain, plus the helpers an interceptor needs.
 *
 * Abstract class rather than an interface because it doubles as a DI token in containers that key on
 * the class name. Subclass it with an empty body for a distinct token that inherits this shape — two
 * clients in one app (an api and a payments provider, say) must not resolve to each other.
 *
 * @example Declare a token and resolve one instance per app
 * ```ts
 * export abstract class ApiFetch extends FetchClient {}
 * export const useApiFetch = () => inject(ApiFetch, () => createFetch(useOAuthFetch()))
 * ```
 */
export abstract class FetchClient {
  /**
   * The composed transport, to hand to {@link rest} or call directly.
   *
   * A stable reference: the chain is composed per call, so a consumer may capture this before any
   * interceptor has registered and still see every one of them.
   *
   * @example
   * ```ts
   * const client = rest(() => `${sitePath}/products`, api.fetch)
   * ```
   */
  fetch!: typeof fetch

  /**
   * Register an interceptor. First registered ends up outermost — it sees the request first and the
   * response last. Registration order is therefore the order you read them in.
   *
   * @param interceptor middleware wrapping the rest of the chain
   *
   * @example Count in-flight requests
   * ```ts
   * client.use(next => async (input, init) => {
   *   pending++
   *   try {
   *     return await next(input, init)
   *   } finally {
   *     pending--
   *   }
   * })
   * ```
   */
  use!: (interceptor: FetchInterceptor) => void

  /**
   * The url of a `fetch` input, whichever of the three forms it arrived in. A `Request` stringifies
   * to `'[object Request]'`, so it cannot simply be templated into a string.
   *
   * @returns the absolute or relative url as written by the caller — not normalised
   *
   * @example
   * ```ts
   * client.use(next => (input, init) => (isApiRequest(client.toUrl(input)) && next(input, stamped(init))) || next(input, init))
   * ```
   */
  toUrl!: (input: RequestInfo | URL) => string

  /**
   * A copy of `init` carrying one more header. Copies rather than mutates: the `init` an interceptor
   * receives belongs to the caller, and the same object may be reused across a retry.
   *
   * @param init the incoming `RequestInit`, or `undefined` when the caller passed none
   * @returns a new `RequestInit`; the original is untouched
   *
   * @example
   * ```ts
   * client.use(next => (input, init) => next(input, client.withHeader(init, 'x-session', sessionId)))
   * ```
   */
  withHeader!: (init: RequestInit | undefined, name: string, value: string) => RequestInit
}

/**
 * The url of a `fetch` input, whichever of the three forms it arrived in. A `Request` stringifies to
 * `'[object Request]'`, so it cannot simply be templated into a string.
 *
 * Also reachable as {@link FetchClient.toUrl}, so an interceptor needs no second import. Exported on its
 * own because it is a pure function: a chain composed elsewhere — Angular DI multi-providers, say — still
 * wants it, and should not have to build a throwaway client to reach it.
 *
 * @returns the absolute or relative url as written by the caller — not normalised
 */
export const toUrl = (input: RequestInfo | URL): string =>
  (typeof input === 'string' && input) || (input instanceof URL && input.href) || (input as Request).url

/**
 * A copy of `init` carrying one more header. Copies rather than mutates: the `init` an interceptor
 * receives belongs to the caller, and the same object may be reused across a retry.
 *
 * Also reachable as {@link FetchClient.withHeader}; standalone for the same reason as {@link toUrl}.
 *
 * @param init the incoming `RequestInit`, or `undefined` when the caller passed none
 * @returns a new `RequestInit`; the original is untouched
 */
export const withHeader = (init: RequestInit | undefined, name: string, value: string): RequestInit => {
  const headers = new Headers(init?.headers)
  headers.set(name, value)
  return { ...init, headers }
}

/**
 * Build a {@link FetchClient} over a base transport.
 *
 * @param base the transport the chain bottoms out in — an OAuth fetch, plain `fetch`, or a mock
 * @returns a client whose `fetch` is stable and whose chain reflects every interceptor registered so far
 *
 * @example
 * ```ts
 * const client = createFetch()
 * client.use(next => (input, init) => next(input, client.withHeader(init, 'x-site', siteId)))
 * await client.fetch('/api/v2/products/123')
 * ```
 */
export const createFetch = (base: typeof fetch = fetch): FetchClient => {
  const interceptors: FetchInterceptor[] = []
  // composed per call rather than at registration: a consumer registers its interceptor during its own
  // setup, which runs after other consumers have already captured `fetch`
  const doFetch: typeof fetch = (input, init) =>
    interceptors.reduceRight<typeof fetch>((next, interceptor) => interceptor(next), base)(input, init)
  return {
    fetch: doFetch,
    use: interceptor => void interceptors.push(interceptor),
    toUrl,
    withHeader
  }
}
