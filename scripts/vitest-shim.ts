/**
 * Minimal stand-in for `vitest` used ONLY when vitest is not installed (offline sandbox).
 * CI and normal dev use the real vitest (`npm test`). Tests import from 'vitest' either way.
 */
type Fn = () => void | Promise<void>;
const suites: string[] = [];
const queue: { name: string; fn: Fn }[] = [];
export function describe(name: string, fn: () => void) { suites.push(name); fn(); suites.pop(); }
export function it(name: string, fn: Fn) { queue.push({ name: [...suites, name].join(' > '), fn }); }
export const test = it;
const eq = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => eq(a[k], b[k]));
};
const matches = (a: any, b: any): boolean =>
  typeof b === 'object' && b !== null ? Object.entries(b).every(([k, v]) => matches(a?.[k], v)) : a === b;
function mk(actual: any, neg = false) {
  const chk = (ok: boolean, msg: string) => { if (ok === neg) throw new Error((neg ? 'NOT ' : '') + msg); };
  const api: any = {
    toBe: (e: any) => chk(Object.is(actual, e), `expected ${JSON.stringify(actual)} to be ${JSON.stringify(e)}`),
    toEqual: (e: any) => chk(eq(actual, e), `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(e)}`),
    toMatchObject: (e: any) => chk(matches(actual, e), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(e)}`),
    toContain: (e: any) => chk(actual.includes(e), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(e)}`),
    toMatch: (re: RegExp | string) => chk(typeof re === 'string' ? String(actual).includes(re) : re.test(String(actual)), `expected ${JSON.stringify(actual)} to match ${re}`),
    toBeNull: () => chk(actual === null, `expected ${JSON.stringify(actual)} null`),
    toBeCloseTo: (n: number, digits = 2) => chk(Math.abs((actual as number) - n) < Math.pow(10, -digits) / 2, `expected ${actual} close to ${n}`),
    toBeDefined: () => chk(actual !== undefined, "expected a defined value"),
    toBeTruthy: () => chk(!!actual, `expected ${JSON.stringify(actual)} truthy`),
    toBeFalsy: () => chk(!actual, `expected ${JSON.stringify(actual)} falsy`),
    toBeUndefined: () => chk(actual === undefined, `expected ${JSON.stringify(actual)} undefined`),
    toHaveLength: (n: number) => chk(actual.length === n, `expected length ${actual.length} to be ${n}`),
    toBeGreaterThan: (n: number) => chk(actual > n, `expected ${actual} > ${n}`),
    toBeLessThan: (n: number) => chk(actual < n, `expected ${actual} < ${n}`),
    toThrow: (re?: RegExp | string) => {
      let threw = false, msg = '';
      try { actual(); } catch (e: any) { threw = true; msg = String(e?.message ?? e); }
      chk(threw && (!re || (typeof re === 'string' ? msg.includes(re) : re.test(msg))), `expected function to throw ${re ?? ''} (got: ${msg})`);
    },
  };
  if (!neg) api.not = mk(actual, true);
  return api;
}
export const expect = (a: any) => mk(a);
export async function __run(): Promise<number> {
  let pass = 0, fail = 0;
  for (const t of queue) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); }
    catch (e: any) { fail++; console.log('  FAIL ' + t.name + '\n       ' + String(e?.message ?? e).split('\n').join('\n       ')); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
