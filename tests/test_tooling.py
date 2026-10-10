import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

class DemoSafetyTests(unittest.TestCase):
    def validator(self):
        spec = importlib.util.spec_from_file_location('demo_safety', ROOT / 'scripts/demo_safety.py')
        self.assertIsNotNone(spec)
        self.assertTrue(Path(spec.origin).exists(), 'Disposable-target validation must exist before reset')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.validate_demo_database

    def test_only_disposable_loopback_database_is_accepted(self):
        validate = self.validator()
        for host in ('localhost', '127.0.0.1', '[::1]', 'demo-db'):
            validate(f'postgresql://demo:demo@{host}:5432/bos_portfolio_demo')

    def test_external_database_options_and_wrong_names_are_refused(self):
        validate = self.validator()
        for dsn in ('', 'service=prod', 'postgresql://demo:demo@example.org/bos_portfolio_demo',
                    'postgresql://demo:demo@localhost/ozon_control',
                    'postgresql://demo:demo@localhost/bos_portfolio_demo?host=example.org',
                    'postgresql://demo:demo@localhost/bos_portfolio_demo#extra',
                    'postgresql://demo:demo@localhost/bos_portfolio_demo/extra'):
            with self.subTest(dsn=dsn):
                with self.assertRaises(ValueError): validate(dsn)

    def test_libpq_environment_cannot_redirect_a_local_demo_connection(self):
        validate = self.validator()
        for key in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSFILE'):
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    validate('postgresql://demo@localhost/bos_portfolio_demo', {key: 'synthetic'})

    def test_refused_demo_stops_before_generation_or_connection(self):
        env = dict(os.environ, DATABASE_URL='postgresql://demo@example.org/not_demo')
        before = (ROOT / 'sample_data/DEMO_TODAY').read_bytes()
        run = subprocess.run([sys.executable, 'scripts/run_demo.py'], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('DEMO_TARGET_REFUSED', run.stderr)
        self.assertEqual((ROOT / 'sample_data/DEMO_TODAY').read_bytes(), before)
        self.assertNotIn('example.org', run.stderr)

class ToolingTests(unittest.TestCase):
    def test_generated_russian_example_keeps_unicode_text(self):
        text = (ROOT / 'examples/report_example.txt').read_text(encoding='utf-8')
        self.assertIn('Утренний отчёт DemoBrand', text)
        self.assertNotIn('РЈС', text)

    def test_workflow_sync_detects_a_changed_export_without_writing(self):
        workflow = json.loads((ROOT / 'workflows/daily_report_0900.json').read_text(encoding='utf-8'))
        for node in workflow['nodes']:
            if node['name'] == 'Build Report Message': node['parameters']['jsCode'] = 'return [];'
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'drift.json'
            file.write_text(json.dumps(workflow), encoding='utf-8')
            before = file.read_bytes()
            result = subprocess.run([sys.executable, 'scripts/inline_renderer_into_workflow.py', '--check', '--workflow', str(file)], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('WORKFLOW_SYNC_FAILED', result.stderr)
            self.assertEqual(file.read_bytes(), before)

    def test_missing_secret_scanner_fails_instead_of_saying_clean(self):
        env = dict(os.environ, GITLEAKS=str(ROOT / 'does-not-exist'))
        result = subprocess.run([sys.executable, 'scripts/scan_secrets.py'], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SECRET_SCAN_NOT_RUN', result.stderr)
        self.assertNotIn('SCAN_PASS', result.stdout)


class LineEndingTests(unittest.TestCase):
    """Generated files must be byte-identical on Windows and Linux (v0.5.1)."""
    ROOT = Path(__file__).resolve().parents[1]

    def test_text_writers_pin_newlines(self):
        import re
        offenders = []
        for f in sorted((self.ROOT / 'scripts').glob('*.py')):
            for i, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
                if re.search(r"""open\([^)]*["']w["']""", line) and 'newline=' not in line:
                    offenders.append(f"{f.name}:{i}")
                if '.write_text(' in line:
                    offenders.append(f"{f.name}:{i} write_text")
        self.assertEqual(offenders, [])

    def test_gitattributes_forces_lf_and_marks_binaries(self):
        rules = (self.ROOT / '.gitattributes').read_text(encoding='utf-8')
        self.assertIn('* text=auto eol=lf', rules)
        for pattern in ('*.xlsx binary', '*.png binary', '*.csv -text'):
            self.assertIn(pattern, rules)

if __name__ == '__main__': unittest.main()
