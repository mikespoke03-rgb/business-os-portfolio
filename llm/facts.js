'use strict';
// Helpers shared by the masking step, the prompt builder and the grader.
// Paths use dots and array indexes: orders.8.u, stock.critical.0.offer.

function flatten(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    if (!entries.length && prefix) out.set(prefix, Array.isArray(value) ? '[]' : '{}');
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.set(prefix, value === undefined ? null : value);
  return out;
}

// Business time: Europe/Moscow. Values with an explicit offset are converted; date-only strings are kept.
function mskParts(v) {
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) || !/(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) {
    return { date: s.slice(0, 10), time: /[T ]\d{2}:\d{2}/.test(s) ? s.slice(11, 16) : null };
  }
  const d = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(d.getTime())) return null;
  const m = new Date(d.getTime() + 3 * 3600 * 1000).toISOString(); // Moscow is fixed UTC+3 since 2014
  return { date: m.slice(0, 10), time: m.slice(11, 16) };
}

const factLines = (flat) => [...flat.entries()].map(([k, v]) => `${k} = ${v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v) : v}`);

module.exports = { flatten, mskParts, factLines };
