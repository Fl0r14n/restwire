import { describe, expect, it } from 'vitest'
import { flatten, isObject } from './util'

describe('isObject', () => {
  it('is true for plain objects only', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ a: 1 })).toBe(true)
    expect(isObject([])).toBe(false)
    expect(isObject(null)).toBeFalsy() // short-circuits to null, not false
    expect(isObject('x')).toBeFalsy()
    expect(isObject(5)).toBe(false)
  })
})

describe('flatten', () => {
  it('flattens nested objects with dot notation', () => {
    expect(flatten({ a: { b: { c: 1 } }, d: 2 })).toEqual({ 'a.b.c': 1, d: 2 })
  })

  it('flattens arrays with bracket index notation', () => {
    expect(flatten({ list: [{ id: 1 }, { id: 2 }] })).toEqual({ 'list[0].id': 1, 'list[1].id': 2 })
  })

  it('keeps primitive array items at their index', () => {
    expect(flatten({ tags: ['a', 'b'] })).toEqual({ 'tags[0]': 'a', 'tags[1]': 'b' })
  })

  it('preserves excluded types as-is instead of descending into them', () => {
    const file = new File(['x'], 'x.txt')
    const out = flatten({ upload: file }, [File])
    expect(out.upload).toBe(file)
  })

  it('does not mutate the input', () => {
    const input = { a: { b: 1 } }
    flatten(input)
    expect(input).toEqual({ a: { b: 1 } })
  })

  it('does not leak state between calls', () => {
    expect(flatten({ a: 1 })).toEqual({ a: 1 })
    expect(flatten({ b: 2 })).toEqual({ b: 2 })
  })
})
