import { describe, expect, it } from 'vitest';
import { PAGES } from '@/lib/pages';
import { PAGE_COMPONENTS } from '@/pageComponents';

describe('shared/pages.json <-> router consistency', () => {
  it('every page in pages.json has a component', () => {
    const missing = PAGES.filter((p) => !PAGE_COMPONENTS[p.key]).map((p) => p.key);
    expect(missing).toEqual([]);
  });

  it('every routed component is listed in pages.json', () => {
    const keys = new Set(PAGES.map((p) => p.key));
    expect(Object.keys(PAGE_COMPONENTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('keys and paths are unique', () => {
    expect(new Set(PAGES.map((p) => p.key)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
  });

  it("each page lives under its role's URL prefix", () => {
    for (const p of PAGES) {
      for (const role of p.roles) expect(p.path.startsWith(`/${role}`)).toBe(true);
    }
  });
});
