'use strict';
// Masking step: runs BEFORE anything is sent to a model. Pure function, driven by llm/config/masking.json.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = path.join(__dirname, 'config', 'masking.json');
const loadConfig = (file = DEFAULT_CONFIG) => JSON.parse(fs.readFileSync(file, 'utf8'));

function ruleFor(config, keyPath, key) {
  return config.rules.find((r) => (r.match_key && new RegExp(r.match_key, 'i').test(key)) || (r.match_path && new RegExp(r.match_path).test(keyPath)));
}

function maskFacts(facts, config = loadConfig()) {
  const report = { dropped: [], redacted: [], rounded: [], patterns: [] };
  const sensitive = { strings: new Set(), numbers: new Set() };
  const patterns = (config.value_patterns || []).map((p) => ({ name: p.name, re: new RegExp(p.regex, 'g') }));
  const remember = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') sensitive.numbers.add(v);
    else if (typeof v === 'string' && v.trim().length >= 3) sensitive.strings.add(v.trim());
    else if (typeof v === 'object') Object.values(v).forEach(remember);
  };
  const walk = (value, keyPath, key) => {
    const rule = keyPath ? ruleFor(config, keyPath, key) : null;
    if (rule && rule.action === 'drop') { report.dropped.push(keyPath); remember(value); return undefined; }
    if (rule && rule.action === 'redact') { report.redacted.push(keyPath); remember(value); return value === null ? null : config.replacement; }
    if (rule && rule.action === 'round' && typeof value === 'number') {
      const to = rule.to || 1000; const rounded = Math.round(value / to) * to;
      if (rounded !== value) { report.rounded.push({ path: keyPath, to }); sensitive.numbers.add(value); }
      return rounded;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, keyPath ? `${keyPath}.${i}` : String(i), String(i)));
    if (value !== null && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) { const m = walk(v, keyPath ? `${keyPath}.${k}` : k, k); if (m !== undefined) out[k] = m; }
      return out;
    }
    if (typeof value === 'string') {
      let s = value;
      for (const p of patterns) if (p.re.test(s)) { p.re.lastIndex = 0; for (const hit of s.match(p.re)) sensitive.strings.add(hit); s = s.replace(p.re, config.replacement); report.patterns.push({ path: keyPath, pattern: p.name }); }
      return s;
    }
    return value;
  };
  const masked = walk(facts, '', '');
  // A dropped number that also appears unmasked elsewhere is not a secret signal (e.g. 0); keep the list precise.
  const kept = new Set(); (function collect(v) { if (typeof v === 'number') kept.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); })(masked);
  for (const n of [...sensitive.numbers]) if (kept.has(n)) sensitive.numbers.delete(n);
  return { facts: masked, report, sensitive: { strings: [...sensitive.strings], numbers: [...sensitive.numbers] } };
}

module.exports = { maskFacts, loadConfig };
