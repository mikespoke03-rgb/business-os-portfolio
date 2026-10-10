// ---- n8n glue for the "Build Report Message" Code node (appended after renderReport by inline_renderer_into_workflow.py) ----
const REPORT_LANG = 'ru';                       // 'ru' | 'en'
const FORBIDDEN = /(analytics\.|raw\.|ops\.|SELECT |n8n|workflow|undefined|NaN)/;   // never leak internals or broken numbers
const ctx = $('Prepare Report').first().json;
let facts = {}; let factsError = null;
try {
  const r = $('Read Report Facts').first().json || {};
  facts = r.j || {};
  if (r.error) factsError = String(r.message || (r.error && (r.error.message || r.error.description)) || 'error').slice(0, 200);
} catch (e) { factsError = String(e).slice(0, 200); }
if (!facts.today) facts.today = ctx.todayMsk;
const out = renderReport(facts, { lang: REPORT_LANG, mode: 'LIVE' });
let replyText = out.text;
// Never drop protected caveats to force a live send. The actual length gate blocks oversized text.
if (factsError) replyText += (REPORT_LANG === 'en' ? '\n\nPart of the data could not be read; sections may be incomplete.' : '\n\nЧасть данных не прочиталась — разделы могут быть неполными.');
const live = facts.live_send || {};
const liveAllowedByFlag = Number(live.value) === 1 && live.status === 'OWNER_ACCEPTED' && !factsError;
return [{ json: { ...ctx, kind: 'REPORT', replyText, forbiddenWords: FORBIDDEN.test(replyText), messageChars: replyText.length,
  messageParts: out.parts.length, liveAllowedByFlag: liveAllowedByFlag && ctx.triggerType === 'SCHEDULED',
  factsDigest: { facts_error: factsError, last_order_day: ((facts.orders || []).slice(-1)[0] || {}).d || null,
    freshness: Object.fromEntries(Object.entries(facts.freshness || {}).map(([k, v]) => [k, v.freshness])), chars: replyText.length } } }];
