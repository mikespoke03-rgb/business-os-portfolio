// Promo approve/reject buttons for Telegram - PRD 002, task 002 (contract only). Pure functions, no I/O.
// The owner's tap is RECORDED as a decision. Nothing here joins or leaves a marketplace promotion.
'use strict';

const VERSION = 'pd1';
const MAX_CALLBACK_BYTES = 64;                      // Telegram limit for callback_data
const DECISIONS = { A: 'APPROVE', R: 'REJECT' };
const LABELS = { ENTER: 'рекомендуем входить', DONT: 'рекомендуем не входить', OWNER_DECIDES: 'решить владельцу' };
const OFFER_RE = /^[A-Z0-9][A-Z0-9-]{0,23}$/;
const compactDate = (iso) => iso.replace(/-/g, '');
const isoDate = (c) => `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;

function callbackData(actionId, offer, decision, asOf) {
  if (!/^\d{1,12}$/.test(String(actionId))) throw new Error('BAD_ACTION_ID');
  if (!OFFER_RE.test(offer)) throw new Error('BAD_OFFER');
  if (!Object.keys(DECISIONS).includes(decision)) throw new Error('BAD_DECISION');
  const data = [VERSION, actionId, offer, decision, compactDate(asOf)].join('|');
  if (Buffer.byteLength(data, 'utf8') > MAX_CALLBACK_BYTES) throw new Error('CALLBACK_TOO_LONG');
  return data;
}

// recommendations: [{ offer, verdict: ENTER|DONT|OWNER_DECIDES, margin_pct }] for one action.
function buildPromoKeyboard(action, recommendations, asOf) {
  const lines = [`Акция «${action.title}» (старт ${action.start.slice(8, 10)}.${action.start.slice(5, 7)}): решение владельца.`];
  const inline_keyboard = [];
  for (const r of recommendations) {
    lines.push(`${r.offer}: ${LABELS[r.verdict] || r.verdict}${r.margin_pct == null ? ', маржа: нет данных' : `, маржа ${r.margin_pct}%`}`);
    inline_keyboard.push([
      { text: `✅ ${r.offer}`, callback_data: callbackData(action.id, r.offer, 'A', asOf) },
      { text: `❌ ${r.offer}`, callback_data: callbackData(action.id, r.offer, 'R', asOf) },
    ]);
  }
  lines.push('Кнопка только записывает решение. В акцию ничего не добавляется автоматически.');
  return { text: lines.join('\n'), reply_markup: { inline_keyboard } };
}

// Validate a tap. today = Moscow business date; only the owner, only today's buttons, only before the action starts.
function parseCallback(data, { today, ownerUserId, fromUserId, actionStart }) {
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_CALLBACK_BYTES) return { ok: false, reason: 'MALFORMED' };
  const parts = data.split('|');
  if (parts.length !== 5 || parts[0] !== VERSION) return { ok: false, reason: 'MALFORMED' };
  const [, actionId, offer, d, asOfCompact] = parts;
  if (!/^\d{1,12}$/.test(actionId) || !OFFER_RE.test(offer) || !DECISIONS[d] || !/^\d{8}$/.test(asOfCompact)) return { ok: false, reason: 'MALFORMED' };
  if (String(fromUserId) !== String(ownerUserId)) return { ok: false, reason: 'NOT_OWNER' };
  const asOf = isoDate(asOfCompact);
  if (asOf !== today) return { ok: false, reason: 'STALE_BUTTON' };
  if (actionStart && today >= actionStart) return { ok: false, reason: 'ACTION_ALREADY_STARTED' };
  return { ok: true, action_id: Number(actionId), offer, decision: DECISIONS[d], as_of: asOf };
}

// Row for the append-only decision log (task 003, planned).
// idem_key identifies the DELIVERY EVENT (Telegram callback_query.id, unique per tap): a re-delivered webhook is a no-op.
// decision_key identifies WHAT is decided (action × SKU); every new owner tap is a new version of it, ordered by the
// monotonic Telegram update_id. History is never overwritten; the latest version wins.
function decisionRow(parsed, { decidedAt, telegramUpdateId, callbackQueryId }) {
  if (!parsed.ok) throw new Error(`REFUSED_${parsed.reason}`);
  if (!callbackQueryId || !Number.isInteger(telegramUpdateId)) throw new Error('MISSING_EVENT_ID');
  return { idem_key: `PD-EV-${callbackQueryId}`, decision_key: `PD-${parsed.action_id}-${parsed.offer}`, action_id: parsed.action_id,
    offer_id: parsed.offer, decision: parsed.decision, as_of: parsed.as_of, decided_at: decidedAt, source: 'telegram',
    telegram_update_id: telegramUpdateId, callback_query_id: callbackQueryId, executed: false };
}

// In-memory model of `INSERT … ON CONFLICT (idem_key) DO NOTHING` on the append-only log.
function appendDecision(log, row) {
  if (log.some((r) => r.idem_key === row.idem_key)) return { log, inserted: false };
  return { log: [...log, row], inserted: true };
}

// Current decision per action × SKU: the row with the highest Telegram update_id (last tap wins).
function currentDecisions(log) {
  const latest = new Map();
  for (const r of log) { const cur = latest.get(r.decision_key); if (!cur || r.telegram_update_id > cur.telegram_update_id) latest.set(r.decision_key, r); }
  return [...latest.values()];
}

module.exports = { callbackData, buildPromoKeyboard, parseCallback, decisionRow, appendDecision, currentDecisions, MAX_CALLBACK_BYTES };
