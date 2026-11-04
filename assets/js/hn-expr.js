/*
 * HVAC Notes: a small, safe evaluator for the formulas in practice problems (no eval, no Function: the CSP forbids
 * both). It reads the JavaScript subset the pages use:
 *   numbers (1, 2.5, 4.1764768e-5), 'strings' and "strings", variables, [lists], ( ),
 *   + - * / % ** , unary - + ! , < <= > >= == != === !== , && || , a ? b : c,
 *   Math without the prefix (sqrt, pow, exp, log, log10, round, floor, ceil, min, max, abs, sin, cos, tan, PI, E, …),
 *   list.find(x => …), .map/.filter/.some/.every/.includes/.indexOf, .length, number.toFixed(n).
 * Variables shadow the Math names, as `with (Math) { with (v) { … } }` did before.
 *   HNExpr.evaluate('max(e10 - d1, 20)', { e10: 80, d1: 12 })  → 68
 */
window.HNExpr = (function () {
  'use strict';
  const MATH = ['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'ceil', 'cos', 'cosh', 'exp', 'expm1', 'floor',
    'hypot', 'log', 'log10', 'log1p', 'log2', 'max', 'min', 'pow', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'];
  const CONST = { PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2 };
  const LIST_METHODS = ['find', 'findIndex', 'map', 'filter', 'some', 'every', 'includes', 'indexOf', 'join', 'slice'];

  function tokenize(src) {
    const out = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (num) { out.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
      const id = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
      if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== c) {
          if (s[j] === '\\' && j + 1 < s.length) { const n = s[j + 1]; v += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; continue; }
          v += s[j++];
        }
        if (j >= s.length) throw new Error('Unclosed string');
        out.push({ t: 'str', v }); i = j + 1; continue;
      }
      const op = /^(?:===|!==|\*\*|=>|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:.,()[\]])/.exec(s.slice(i));
      if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
      throw new Error('Unexpected "' + c + '"');
    }
    out.push({ t: 'end' });
    return out;
  }

  function parse(src) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p], next = () => tk[p++];
    const isOp = v => tk[p].t === 'op' && tk[p].v === v;
    const expect = v => { if (!isOp(v)) throw new Error('Expected ' + v); p++; };

    function expr() { return ternary(); }
    function ternary() {
      const c = or();
      if (isOp('?')) { p++; const a = expr(); expect(':'); const b = expr(); return { k: '?', c, a, b }; }
      return c;
    }
    const binary = (sub, ops) => () => {
      let l = sub();
      while (tk[p].t === 'op' && ops.includes(tk[p].v)) { const o = next().v; l = { k: 'bin', o, l, r: sub() }; }
      return l;
    };
    const or = binary(() => and(), ['||']);
    const and = binary(() => eq(), ['&&']);
    const eq = binary(() => rel(), ['==', '!=', '===', '!==']);
    const rel = binary(() => add(), ['<', '<=', '>', '>=']);
    const add = binary(() => mul(), ['+', '-']);
    const mul = binary(() => pow(), ['*', '/', '%']);
    function pow() {
      const b = unary();
      if (isOp('**')) { p++; return { k: 'bin', o: '**', l: b, r: pow() }; }
      return b;
    }
    function unary() {
      if (isOp('-') || isOp('+') || isOp('!')) { const o = next().v; return { k: 'un', o, x: unary() }; }
      return postfix();
    }
    function args() {
      const list = [];
      if (isOp(')')) { p++; return list; }
      for (;;) {
        if (tk[p].t === 'id' && tk[p + 1].t === 'op' && tk[p + 1].v === '=>') { const param = next().v; p++; list.push({ k: 'fn', param, body: expr() }); }
        else list.push(expr());
        if (isOp(',')) { p++; continue; }
        expect(')'); return list;
      }
    }
    function postfix() {
      let x = primary();
      for (;;) {
        if (isOp('.')) { p++; const n = next(); if (n.t !== 'id') throw new Error('Expected a name'); x = { k: 'get', x, name: n.v }; continue; }
        if (isOp('[')) { p++; const i = expr(); expect(']'); x = { k: 'idx', x, i }; continue; }
        if (isOp('(')) { p++; x = { k: 'call', f: x, args: args() }; continue; }
        return x;
      }
    }
    function primary() {
      const t = next();
      if (t.t === 'num') return { k: 'lit', v: t.v };
      if (t.t === 'str') return { k: 'lit', v: t.v };
      if (t.t === 'id') {
        if (t.v === 'true') return { k: 'lit', v: true };
        if (t.v === 'false') return { k: 'lit', v: false };
        if (t.v === 'null') return { k: 'lit', v: null };
        if (t.v === 'Math' && isOp('.')) { p++; const n = next(); return { k: 'var', name: n.v, math: true }; }
        return { k: 'var', name: t.v };
      }
      if (t.t === 'op' && t.v === '(') { const x = expr(); expect(')'); return x; }
      if (t.t === 'op' && t.v === '[') {
        const items = [];
        if (isOp(']')) { p++; return { k: 'list', items }; }
        for (;;) { items.push(expr()); if (isOp(',')) { p++; continue; } expect(']'); return { k: 'list', items }; }
      }
      throw new Error('Unexpected ' + (t.v || t.t));
    }
    const tree = expr();
    if (peek().t !== 'end') throw new Error('Unexpected ' + peek().v);
    return tree;
  }

  function lookup(name, scope, mathOnly) {
    if (!mathOnly) for (let s = scope; s; s = s.up) if (Object.prototype.hasOwnProperty.call(s.vars, name)) return s.vars[name];
    if (MATH.includes(name)) return Math[name];
    if (Object.prototype.hasOwnProperty.call(CONST, name)) return CONST[name];
    throw new Error('Unknown name ' + name);
  }
  function makeFn(node, scope) {
    return x => run(node.body, { vars: { [node.param]: x }, up: scope });
  }
  function run(n, scope) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'var': return lookup(n.name, scope, n.math);
      case 'list': return n.items.map(x => run(x, scope));
      case 'fn': return makeFn(n, scope);
      case '?': return run(n.c, scope) ? run(n.a, scope) : run(n.b, scope);
      case 'un': { const x = run(n.x, scope); return n.o === '-' ? -x : n.o === '+' ? +x : !x; }
      case 'bin': {
        if (n.o === '&&') return run(n.l, scope) && run(n.r, scope);
        if (n.o === '||') return run(n.l, scope) || run(n.r, scope);
        const l = run(n.l, scope), r = run(n.r, scope);
        switch (n.o) {
          case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r; case '%': return l % r;
          case '**': return Math.pow(l, r);
          case '<': return l < r; case '<=': return l <= r; case '>': return l > r; case '>=': return l >= r;
          case '==': return l == r; case '!=': return l != r; case '===': return l === r; case '!==': return l !== r;   // eslint-disable-line eqeqeq
        }
        break;
      }
      case 'get': {
        const x = run(n.x, scope);
        if (n.name === 'length' && (Array.isArray(x) || typeof x === 'string')) return x.length;
        throw new Error('Cannot read ' + n.name);
      }
      case 'idx': {
        const x = run(n.x, scope), i = run(n.i, scope);
        if ((Array.isArray(x) || typeof x === 'string') && Number.isInteger(i)) return x[i];
        throw new Error('Bad index');
      }
      case 'call': {
        const args = n.args.map(a => run(a, scope));
        if (n.f.k === 'get') {
          const obj = run(n.f.x, scope), name = n.f.name;
          if (Array.isArray(obj) && LIST_METHODS.includes(name)) return Array.prototype[name].apply(obj, args.map(a => typeof a === 'function' ? (x => a(x)) : a));
          if (typeof obj === 'number' && name === 'toFixed') return obj.toFixed(Math.max(0, Math.min(20, args[0] | 0)));
          if (typeof obj === 'string' && ['includes', 'indexOf', 'slice', 'toUpperCase', 'toLowerCase', 'trim'].includes(name)) return String.prototype[name].apply(obj, args);
          throw new Error('Cannot call ' + name);
        }
        const f = run(n.f, scope);
        if (typeof f !== 'function') throw new Error('Not a function');
        return f.apply(null, args);
      }
    }
    throw new Error('Bad expression');
  }

  const cache = new Map();
  function compile(src) {
    if (!cache.has(src)) cache.set(src, parse(src));
    return cache.get(src);
  }
  return {
    evaluate(src, vars) { return run(compile(String(src)), { vars: vars || {}, up: null }); },
    check(src) { compile(String(src)); return true; }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = window.HNExpr;
