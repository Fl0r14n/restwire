/** True for plain objects only — arrays and `null` are not objects for merge/flatten purposes. */
export const isObject = (item: any): boolean => !!item && typeof item === 'object' && !Array.isArray(item)

const flattenInto = (obj: Record<string, any>, exclude: any[], prefix: string, result: Record<string, any>): Record<string, any> => {
  const isExcludedType = (value: any): boolean => exclude.some(type => value instanceof type)
  for (const key in obj) {
    const value = obj[key]
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isExcludedType(value)) {
      result[fullKey] = value
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const arrayKey = `${fullKey}[${index}]`
        if (isExcludedType(item)) {
          result[arrayKey] = item
        } else if (isObject(item) && item !== null) {
          flattenInto(item, exclude, arrayKey, result)
        } else {
          result[arrayKey] = item
        }
      })
    } else if (isObject(value) && value !== null) {
      flattenInto(value, exclude, fullKey, result)
    } else {
      result[fullKey] = value
    }
  }
  return result
}

/**
 * Flatten a nested object to a single level of dotted keys — `{ a: { b: 1 } }` → `{ 'a.b': 1 }`, arrays
 * indexed as `list[0].id`. What `toFormData` is built on, since `FormData` has no notion of nesting.
 *
 * @param obj the object to flatten; not mutated
 * @param exclude constructors whose instances are kept whole rather than descended into — pass
 *   `[File, Blob, Date]` so an upload survives as itself instead of being spread into its properties
 * @returns a new flat object
 *
 * @example
 * ```ts
 * flatten({ user: { name: 'x' }, tags: ['a'] })       // { 'user.name': 'x', 'tags[0]': 'a' }
 * flatten({ upload: file }, [File])                   // { upload: file }
 * ```
 */
export const flatten = (obj: Record<string, any>, exclude: any[] = []): Record<string, any> => flattenInto(obj, exclude, '', {})
