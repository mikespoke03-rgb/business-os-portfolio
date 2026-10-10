-- Cash calendar: opening balance (as stated by the owner - not a bank statement) + planned/estimated events.
CREATE VIEW analytics.v_cash_calendar_daily AS
WITH o AS (SELECT (SELECT as_of_date FROM ops.cash_opening_meta ORDER BY row_id DESC LIMIT 1) AS as_of,
                  analytics.param('cash_opening_rub') AS opening,
                  (SELECT status FROM ops.v_param_current WHERE param_key = 'cash_opening_rub') AS opening_status),
cal AS (SELECT d::date AS day FROM o, generate_series(o.as_of, o.as_of + 120, interval '1 day') d),
ev AS (SELECT event_date AS day, sum(amount_rub) FILTER (WHERE amount_rub > 0) AS inflow, sum(amount_rub) FILTER (WHERE amount_rub < 0) AS outflow,
              string_agg(label || ' ' || round(amount_rub) || ' (' || status || ')', '; ' ORDER BY amount_rub) AS events,
              bool_or(status = 'ESTIMATE') AS has_estimate
       FROM raw.cash_event GROUP BY event_date)
SELECT cal.day, o.as_of AS opening_as_of, o.opening, o.opening_status,
       coalesce(ev.inflow, 0) AS inflow_rub, coalesce(ev.outflow, 0) AS outflow_rub,
       o.opening + sum(coalesce(ev.inflow, 0) + coalesce(ev.outflow, 0)) OVER (ORDER BY cal.day) AS balance_rub,
       ev.events, coalesce(ev.has_estimate, false) AS has_estimate
FROM cal CROSS JOIN o LEFT JOIN ev ON ev.day = cal.day;
COMMENT ON VIEW analytics.v_cash_calendar_daily IS 'Running balance = owner-stated opening + events. If the opening is unknown the whole curve is shifted by the same X; the report says so.';
