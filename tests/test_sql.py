"""Business rules against actual PostgreSQL. Each test rolls back its fixtures."""
import os
from pathlib import Path
import sys
import unittest
from decimal import Decimal
import psycopg2
import json
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from demo_safety import validate_demo_database
from export_report_facts import read_facts

class SQLBusinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dsn = validate_demo_database(os.environ.get('DATABASE_URL', ''))
        cls.db = psycopg2.connect(dsn, connect_timeout=5)

    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        self.cur = self.db.cursor()
        self.cur.execute("SELECT set_config('bos.today', '2026-04-15', true)")

    def tearDown(self):
        self.db.rollback()
        self.cur.close()

    def one(self, query, params=()):
        self.cur.execute(query, params)
        return self.cur.fetchone()

    def order(self, offer, units, revenue, captured='2026-04-15 07:00:00+03'):
        self.cur.execute("INSERT INTO raw.order_day_sku_obs (business_date,offer_id,ordered_units,cancelled_units,order_revenue_rub,captured_at,run_id) VALUES ('2026-04-14',%s,%s,0,%s,%s,'test-only')", (offer, units, revenue, captured))

    def test_latest_observation_does_not_double_count_revenue(self):
        self.order('TEST-LATEST', 2, 100)
        self.order('TEST-LATEST', 3, 150, '2026-04-15 08:00:00+03')
        self.assertEqual(self.one("SELECT ordered_units, order_revenue_rub FROM analytics.v_orders_day_sku WHERE offer_id='TEST-LATEST'"), (3, Decimal('150')))

    def test_missing_observation_is_not_a_zero_row(self):
        self.assertIsNone(self.one("SELECT ordered_units FROM analytics.v_orders_day_sku WHERE offer_id='TEST-ABSENT'"))
        self.order('TEST-ZERO', 0, 0)
        self.assertEqual(self.one("SELECT ordered_units FROM analytics.v_orders_day_sku WHERE offer_id='TEST-ZERO'"), (0,))

    def test_source_dates_produce_stale_fresh_and_no_data(self):
        self.assertEqual(self.one("SELECT freshness FROM analytics.v_source_freshness WHERE source='orders_by_sku'"), ('STALE',))
        self.order('TEST-FRESH', 1, 100)
        self.assertEqual(self.one("SELECT freshness FROM analytics.v_source_freshness WHERE source='orders_by_sku'"), ('FRESH',))
        self.cur.execute('CREATE OR REPLACE VIEW analytics.v_orders_day_sku AS SELECT business_date, offer_id, ordered_units, cancelled_units, order_revenue_rub, captured_at FROM raw.order_day_sku_obs WHERE false')
        self.assertEqual(self.one("SELECT freshness, last_day FROM analytics.v_source_freshness WHERE source='orders_by_sku'"), ('NO_DATA', None))

    def test_missing_ads_report_has_null_orders(self):
        self.assertEqual(self.one("SELECT ppo_status, ppo_orders FROM analytics.v_ads_day_total WHERE stat_day='2026-04-14'"), ('MISSING', None))

    def test_missing_cost_blocks_contribution_instead_of_partial_sum(self):
        self.cur.execute("INSERT INTO raw.sku VALUES ('TEST-COSTED',9000002,'Test','Тест','A')")
        self.cur.execute("INSERT INTO raw.sku_cost_obs (offer_id,cogs_ex_vat_rub,customs_vat_rub,valid_from,captured_at) VALUES ('TEST-COSTED',10,0,'2026-01-01','2026-04-15')")
        self.order('TEST-COSTED', 2, 200)
        self.order('TEST-NO-COST', 1, 100)
        self.assertIsNone(self.one("SELECT margin_before_ads_rub FROM analytics.v_unit_margin_day WHERE business_date='2026-04-14'")[0])

    def test_missing_ads_cost_blocks_contribution_instead_of_zero_spend(self):
        self.cur.execute("INSERT INTO raw.sku VALUES ('TEST-NEW',9000001,'Test','Тест','A')")
        self.cur.execute("INSERT INTO raw.sku_cost_obs (offer_id,cogs_ex_vat_rub,customs_vat_rub,valid_from,captured_at) VALUES ('TEST-NEW',10,0,'2026-01-01','2026-04-15')")
        self.cur.execute("INSERT INTO raw.order_day_sku_obs (business_date,offer_id,ordered_units,cancelled_units,order_revenue_rub,captured_at,run_id) VALUES ('2026-04-15','TEST-NEW',1,0,100,'2026-04-15','test-only')")
        self.assertIsNone(self.one("SELECT contribution_order_model_rub FROM analytics.v_breakeven_daily WHERE business_date='2026-04-15'")[0])

    def test_raw_and_delivery_tables_reject_mutation(self):
        for query in ("UPDATE raw.sku SET abc_class='C'", 'DELETE FROM raw.sku', 'TRUNCATE raw.order_day_sku_obs', 'TRUNCATE ops.report_delivery'):
            with self.subTest(query=query):
                self.cur.execute('SAVEPOINT mutation_check')
                with self.assertRaises(psycopg2.Error) as error: self.cur.execute(query)
                self.assertIn('append-only', str(error.exception))
                self.cur.execute('ROLLBACK TO SAVEPOINT mutation_check')

    def test_second_daily_claim_returns_no_permission(self):
        js = "const w=require('./workflows/daily_report_0900.json');const q=w.nodes.find(n=>n.name==='Claim Send (once per day)').parameters.query;const r={asOfDate:'2026-04-15',replyText:'synthetic',messageSha256:'0'.repeat(64)};const lookup=()=>({first:()=>({json:r})});console.log(new Function('$','return ('+q.slice(3,-2)+');')(lookup));"
        query = subprocess.check_output(['node', '-e', js], cwd=Path(__file__).resolve().parents[1], text=True)
        self.assertIsNotNone(self.one(query))
        self.assertIsNone(self.one(query))
        self.assertEqual(self.one("SELECT count(*) FROM ops.report_delivery WHERE idem_key='REPORT-2026-04-15-LIVE'"), (1,))

    def test_report_has_one_row_and_unaccepted_live_flag(self):
        self.cur.execute('SELECT j FROM analytics.v_report_facts')
        rows = self.cur.fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0]['today'], '2026-04-15')
        self.assertEqual(rows[0][0]['live_send']['value'], 0)

    def test_hand_calculated_margin_and_coverage_with_complete_inputs(self):
        self.cur.execute("SELECT set_config('bos.today', '2026-04-17', true)")
        values = {'commission_pct': '0.1', 'acquiring_pct': '0.01', 'logistics_rub_per_unit': '5',
                  'vat_rate': '0.2', 'vat_base_share': '0.5', 'buyout_rate': '0.8',
                  'fixed_costs_month_rub': '300', 'financing_cost_month_rub': '0'}
        for key, value in values.items():
            self.cur.execute("INSERT INTO ops.param (param_key,param_value,status,set_at) VALUES (%s,%s,'ESTIMATE','2099-01-01')", (key, value))
        self.cur.execute("INSERT INTO raw.sku VALUES ('TEST-ECON',9000003,'Test','Тест','A')")
        self.cur.execute("INSERT INTO raw.sku_cost_obs (offer_id,cogs_ex_vat_rub,customs_vat_rub,valid_from,captured_at) VALUES ('TEST-ECON',10,0,'2026-01-01','2026-04-15')")
        self.cur.execute("INSERT INTO raw.order_day_sku_obs (business_date,offer_id,ordered_units,cancelled_units,order_revenue_rub,captured_at,run_id) VALUES ('2026-04-16','TEST-ECON',2,0,200,'2026-04-17','test-only')")
        self.cur.execute("INSERT INTO raw.ads_cpc_campaign_day_obs (stat_day,campaign_id,spend_rub,captured_at) VALUES ('2026-04-16','CPC0',10,'2099-01-01')")
        self.cur.execute("INSERT INTO raw.ads_expense_obs (provider_day,campaign_id,expense_rub,captured_at) VALUES ('2026-04-16','PPO1',5,'2099-01-01')")
        # revenue 200 - fees 32 - COGS 20 - model VAT 16.67 - ads 15 = 116.33.
        self.assertEqual(self.one("SELECT contribution_order_model_rub, breakeven_bar_day_rub, coverage_order_pct FROM analytics.v_breakeven_daily WHERE business_date='2026-04-16'"), (Decimal('116.33'), Decimal('10'), Decimal('1163.3')))

    def test_month_gap_stays_unknown_after_a_day_with_missing_cost(self):
        self.cur.execute("SELECT gap_mtd_order_rub FROM analytics.v_breakeven_daily WHERE business_date='2026-04-13'")
        self.assertIsNotNone(self.cur.fetchone()[0])
        self.order('TEST-NO-COST', 1, 100)
        self.assertIsNone(self.one("SELECT gap_mtd_order_rub FROM analytics.v_breakeven_daily WHERE business_date='2026-04-14'")[0])

    def test_export_pins_moscow_time_even_when_session_is_utc(self):
        # Neon and the postgres image default to UTC; the exporter must not depend on that.
        self.cur.execute("SET TIME ZONE 'UTC'")
        self.cur.execute("SELECT (j->'prices'->>'cap') FROM analytics.v_report_facts")
        self.assertTrue(self.cur.fetchone()[0].startswith('2026-04-15T05:48'), 'precondition: a UTC session shifts timestamps')
        facts = read_facts(self.db, '2026-04-15')
        self.assertEqual(facts['prices']['cap'][:16], '2026-04-15T08:48')
        self.assertTrue(facts['prices']['cap'].endswith('+03:00'))
        self.assertEqual(facts['stock']['cap'][:16], '2026-04-15T07:15')
        self.assertEqual(facts['promo']['measured_at'][:16], '2026-04-15T08:41')
        self.assertEqual(facts['orders'][-1]['loaded_at'][:16], '2026-04-14T05:30')

if __name__ == '__main__': unittest.main()
