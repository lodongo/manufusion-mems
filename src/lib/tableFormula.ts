// Formula columns for rich tables.
//
// A small, safe expression language evaluated per row. It is parsed into a tree and never passed to eval or Function,
// so a formula can only do arithmetic on the row's own values.
//
//   [Quantity] * [Unit price]              column references by label (or key) in square brackets
//   SUM([Q1], [Q2], [Q3])                   SUM, AVG (AVERAGE), MIN, MAX, COUNT ignore empty cells
//   ROUND([Amount] / [Qty], 2)              ROUND(x, digits), ABS(x), PCT(part, whole) = part ÷ whole × 100
//   ([Actual] - [Budget]) / [Budget] * 100  + - * / and parentheses, numbers like 1,000.5 are written 1000.5
//
// In arithmetic an empty cell counts as 0 (as in a spreadsheet); division by zero gives an empty result.

export type Num = number | null;
type Node =
    | { t: 'num'; v: number }
    | { t: 'ref'; key: string }
    | { t: 'neg'; a: Node }
    | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
    | { t: 'fn'; name: string; args: Node[] };

export const FUNCTIONS: Record<string, { min: number; max: number; help: string }> = {
    SUM: { min: 1, max: 30, help: 'Total of the values' },
    AVG: { min: 1, max: 30, help: 'Simple average of the values' },
    AVERAGE: { min: 1, max: 30, help: 'Same as AVG' },
    MIN: { min: 1, max: 30, help: 'Smallest value' },
    MAX: { min: 1, max: 30, help: 'Largest value' },
    COUNT: { min: 1, max: 30, help: 'Number of filled values' },
    ROUND: { min: 1, max: 2, help: 'ROUND(value, digits)' },
    ABS: { min: 1, max: 1, help: 'Value without sign' },
    PCT: { min: 2, max: 2, help: 'PCT(part, whole) = part ÷ whole × 100' },
};

export const MAX_FORMULA_LENGTH = 300;
/** Printable text only (no control characters, angle brackets, backticks or backslashes). */
export const FORMULA_CHARS = /^[^\u0000-\u001f\u007f<>`\\]*$/;

export class FormulaError extends Error {}

/** Parses a formula. `resolve` maps a bracketed name to a column key, or returns undefined when there is none. */
export function parseFormula(src: string, resolve: (name: string) => string | undefined): { node: Node; refs: string[] } {
    const text = src.trim();
    if (!text) throw new FormulaError('Enter a formula.');
    if (text.length > MAX_FORMULA_LENGTH) throw new FormulaError(`Keep the formula under ${MAX_FORMULA_LENGTH} characters.`);
    if (!FORMULA_CHARS.test(text)) throw new FormulaError('The formula has characters that are not allowed (< > ` \\ or control characters).');
    let i = 0;
    const refs = new Set<string>();
    let depth = 0;
    const ws = () => {
        while (text[i] === ' ') i++;
    };
    const fail = (msg: string): never => {
        throw new FormulaError(`${msg} (at character ${i + 1}).`);
    };
    const expr = (): Node => {
        let left = term();
        for (;;) {
            ws();
            const c = text[i];
            if (c !== '+' && c !== '-') return left;
            i++;
            left = { t: 'bin', op: c, a: left, b: term() };
        }
    };
    const term = (): Node => {
        let left = factor();
        for (;;) {
            ws();
            const c = text[i];
            if (c !== '*' && c !== '/') return left;
            i++;
            left = { t: 'bin', op: c, a: left, b: factor() };
        }
    };
    const factor = (): Node => {
        ws();
        if (++depth > 40) fail('The formula is nested too deeply');
        try {
            const c = text[i];
            if (c === undefined) return fail('The formula ends too early');
            if (c === '-') {
                i++;
                return { t: 'neg', a: factor() };
            }
            if (c === '+') {
                i++;
                return factor();
            }
            if (c === '(') {
                i++;
                const n = expr();
                ws();
                if (text[i] !== ')') fail('A closing bracket ) is missing');
                i++;
                return n;
            }
            if (c === '[') {
                const end = text.indexOf(']', i);
                if (end < 0) fail('A closing ] is missing');
                const name = text.slice(i + 1, end).trim();
                const key = resolve(name);
                if (!key) fail(`There is no column called "${name}"`);
                refs.add(key!);
                i = end + 1;
                return { t: 'ref', key: key! };
            }
            if (/[0-9.]/.test(c)) {
                const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|^[0-9]+\.?/.exec(text.slice(i));
                if (!m) return fail('This number is not valid');
                i += m[0].length;
                const v = Number(m[0]);
                if (!Number.isFinite(v)) fail('This number is not valid');
                return { t: 'num', v };
            }
            if (/[A-Za-z]/.test(c)) {
                const m = /^[A-Za-z]+/.exec(text.slice(i))!;
                const name = m[0].toUpperCase();
                const def = FUNCTIONS[name];
                if (!def) fail(`Unknown function ${m[0]}. Use ${Object.keys(FUNCTIONS).join(', ')}, or put column names in [brackets]`);
                i += m[0].length;
                ws();
                if (text[i] !== '(') fail(`${name} needs ( after it`);
                i++;
                const args: Node[] = [];
                ws();
                if (text[i] !== ')') {
                    for (;;) {
                        args.push(expr());
                        ws();
                        if (text[i] === ',') {
                            i++;
                            continue;
                        }
                        break;
                    }
                }
                if (text[i] !== ')') fail(`${name}( is not closed`);
                i++;
                if (args.length < def.min || args.length > def.max) fail(`${name} takes ${def.min === def.max ? def.min : `${def.min} to ${def.max}`} value(s)`);
                return { t: 'fn', name, args };
            }
            return fail(`Unexpected "${c}"`);
        } finally {
            depth--;
        }
    };
    const node = expr();
    ws();
    if (i < text.length) fail(`Unexpected "${text[i]}"`);
    return { node, refs: [...refs] };
}

const z = (v: Num) => (v === null ? 0 : v);
function evalNode(n: Node, get: (key: string) => Num): Num {
    switch (n.t) {
        case 'num':
            return n.v;
        case 'ref':
            return get(n.key);
        case 'neg': {
            const a = evalNode(n.a, get);
            return a === null ? null : -a;
        }
        case 'bin': {
            const a = evalNode(n.a, get);
            const b = evalNode(n.b, get);
            if (a === null && b === null) return null;
            if (n.op === '+') return z(a) + z(b);
            if (n.op === '-') return z(a) - z(b);
            if (n.op === '*') return z(a) * z(b);
            return z(b) === 0 ? null : z(a) / z(b);
        }
        case 'fn': {
            const vals = n.args.map((x) => evalNode(x, get));
            const filled = vals.filter((v): v is number => v !== null && Number.isFinite(v));
            switch (n.name) {
                case 'SUM':
                    return filled.length ? filled.reduce((s, v) => s + v, 0) : null;
                case 'AVG':
                case 'AVERAGE':
                    return filled.length ? filled.reduce((s, v) => s + v, 0) / filled.length : null;
                case 'MIN':
                    return filled.length ? Math.min(...filled) : null;
                case 'MAX':
                    return filled.length ? Math.max(...filled) : null;
                case 'COUNT':
                    return filled.length;
                case 'ABS':
                    return vals[0] === null ? null : Math.abs(vals[0]);
                case 'ROUND': {
                    if (vals[0] === null) return null;
                    const d = Math.max(0, Math.min(10, Math.trunc(z(vals[1] ?? 0))));
                    const f = 10 ** d;
                    return Math.round(vals[0] * f) / f;
                }
                case 'PCT':
                    return vals[0] === null || !z(vals[1]) ? null : (vals[0] / z(vals[1])) * 100;
            }
            return null;
        }
    }
}

/** Evaluates a parsed formula; any non-finite result is empty. */
export function evaluate(node: Node, get: (key: string) => Num): Num {
    const v = evalNode(node, get);
    return v === null || !Number.isFinite(v) ? null : Math.round(v * 1e9) / 1e9;
}

/** Converts a cell value to a number: numbers as they are, text like "1,250.50", "KES 1,250" or "12%" when it is clearly one. */
export function toNumber(v: unknown): Num {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/^[A-Z]{3}\s+/, '').replace(/[,\s]/g, '').replace(/%$/, '');
    if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/** Quick formulas for people who do not want to type one. */
export const QUICK: Array<{ id: string; label: string; min: number; max: number; build: (refs: string[]) => string }> = [
    { id: 'sum', label: 'Sum of columns', min: 2, max: 10, build: (r) => `SUM(${r.join(', ')})` },
    { id: 'avg', label: 'Simple average of columns', min: 2, max: 10, build: (r) => `AVG(${r.join(', ')})` },
    { id: 'min', label: 'Smallest of columns', min: 2, max: 10, build: (r) => `MIN(${r.join(', ')})` },
    { id: 'max', label: 'Largest of columns', min: 2, max: 10, build: (r) => `MAX(${r.join(', ')})` },
    { id: 'diff', label: 'Difference (first − second)', min: 2, max: 2, build: (r) => `${r[0]} - ${r[1]}` },
    { id: 'prod', label: 'Product (multiply)', min: 2, max: 5, build: (r) => r.join(' * ') },
    { id: 'ratio', label: 'Ratio (first ÷ second)', min: 2, max: 2, build: (r) => `${r[0]} / ${r[1]}` },
    { id: 'pct', label: 'Percentage (first ÷ second × 100)', min: 2, max: 2, build: (r) => `PCT(${r[0]}, ${r[1]})` },
];
