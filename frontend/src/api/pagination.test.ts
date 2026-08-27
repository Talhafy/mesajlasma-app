import { describe, expect, it } from 'vitest';
import { unwrapItems } from './pagination';

describe('unwrapItems', () => {
  it('keeps legacy array responses intact', () => {
    const items = [{ id: 'one' }];
    expect(unwrapItems(items)).toBe(items);
  });

  it('extracts cursor-paginated items', () => {
    expect(unwrapItems({ items: [{ id: 'one' }], nextCursor: null })).toEqual([{ id: 'one' }]);
  });

  it('fails closed for malformed or empty responses', () => {
    expect(unwrapItems(undefined)).toEqual([]);
    expect(unwrapItems({ items: null } as never)).toEqual([]);
  });
});
