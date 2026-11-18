import { describe, expect, it } from 'vitest'
import { renderWindow } from '../../../src/renderer/src/reader/renderWindow'

describe('renderWindow', () => {
  it('keeps the visible pages plus one either side', () => {
    expect(renderWindow(5, 6, 300)).toEqual([4, 5, 6, 7])
    expect(renderWindow(1, 1, 300)).toEqual([1, 2])
    expect(renderWindow(300, 300, 300)).toEqual([299, 300])
  })
  it('honours another margin and a one-page document', () => {
    expect(renderWindow(5, 5, 300, 0)).toEqual([5])
    expect(renderWindow(5, 5, 300, 2)).toEqual([3, 4, 5, 6, 7])
    expect(renderWindow(1, 1, 1)).toEqual([1])
  })
})
