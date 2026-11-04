// The practice-problem evaluator (assets/js/hn-expr.js): results equal to plain JavaScript, refusals for anything else.
import { createRequire } from 'node:module';
globalThis.window = globalThis;
const E = createRequire(import.meta.url)('../../assets/js/hn-expr.js');
const v = { a: 3, b: 4.5, t: 46, list: [1, 1.5, 2, 3, 5], s: 'x' };
const same = [
  ['a + b * 2', a => 3 + 4.5 * 2], ['(a + b) / 2', () => 3.75], ['2 ** 3 ** 2', () => 2 ** 3 ** 2], ['-a ** 2', null],
  ['max(a, b) - min(a, b)', () => 1.5], ['sqrt(16) + pow(2, 3) + abs(-1)', () => 13], ['round(b) + floor(b) + ceil(b)', () => 14],
  ['exp(-5800.2206/(t+273.15)+1.3914993-0.048640239*(t+273.15)+4.1764768e-5*pow(t+273.15,2))', () => Math.exp(-5800.2206 / (46 + 273.15) + 1.3914993 - 0.048640239 * (46 + 273.15) + 4.1764768e-5 * Math.pow(46 + 273.15, 2))],
  ["a >= 3 ? 'yes' : 'no'", () => 'yes'], ["a == 3 && b != 4", () => true], ["'n=' + a", () => 'n=3'],
  ['list.find(m => m >= b * 0.5)', () => 3], ['[1, 2, 3].map(x => x * a)[2]', () => 9], ['list.length', () => 5], ['b.toFixed(1)', () => '4.5'],
  ['PI * 2', () => Math.PI * 2], ['Math.sqrt(9)', () => 3], ['log(E)', () => 1]
];
let bad = 0;
for (const [src, f] of same) {
  if (!f) { try { E.evaluate(src, v); } catch (e) { continue; } continue; }
  const got = E.evaluate(src, v), want = f();
  if (!Object.is(got, want)) { bad++; console.log('  FAIL', src, got, want); }
}
for (const src of ['constructor', 'a.constructor', "this", "window", "alert(1)", "list.constructor('x')", "s.constructor", "(()=>1)()", "a = 2", "fetch('x')", '__proto__']) {
  try { E.evaluate(src, v); bad++; console.log('  FAIL not refused:', src); } catch (e) { /* refused */ }
}
console.log(bad ? `${bad} FAILED` : `evaluator: ${same.length} results and 11 refusals as expected`);
process.exit(bad ? 1 : 0);
