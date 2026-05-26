import { describe, expect, it } from 'vitest';

describe('canary (unit)', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2);
  });
});
