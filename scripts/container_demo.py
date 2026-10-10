"""Container entrypoint: no n8n/Ozon/Telegram access, synthetic output only."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, 'scripts/run_demo.py', '--no-generate'], cwd=root, check=True)
subprocess.run([sys.executable, 'scripts/check.py', '--sql'], cwd=root, check=True)
output = Path('/output')
output.mkdir(parents=True, exist_ok=True)
for file in (root / 'examples').iterdir():
    if file.is_file(): shutil.copy2(file, output / file.name)
print('DEMO_COMPLETE: synthetic reports, facts, scenarios and workbook are in /output; no messages sent')
