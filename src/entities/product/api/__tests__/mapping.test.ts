import { describe, it, expect } from 'vitest';
import { pickLowestPrice } from '../mapping';

describe('pickLowestPrice', () => {
  it('should return null for empty array', () => {
    const result = pickLowestPrice([]);
    expect(result).toBeNull();
  });

  it('should return priceAdult for single item', () => {
    const result = pickLowestPrice([{ priceAdult: 500000 }]);
    expect(result).toBe(500000);
  });

  it('should return lowest price from sorted array', () => {
    const departures = [
      { priceAdult: 300000 },
      { priceAdult: 100000 },
      { priceAdult: 200000 },
    ];
    const result = pickLowestPrice(departures);
    expect(result).toBe(100000);
  });
});
