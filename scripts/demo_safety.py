"""Reject non-disposable targets before the demo can connect or reset schemas."""
from urllib.parse import urlsplit
import os

def validate_demo_database(dsn, environment=None):
    environment = os.environ if environment is None else environment
    if any(key.startswith('PG') and key != 'PGPASSWORD' and value for key, value in environment.items()):
        raise ValueError('DEMO_TARGET_REFUSED: libpq environment overrides are forbidden; only PGPASSWORD is allowed')
    try:
        url = urlsplit(dsn)
        valid = (url.scheme in ('postgres', 'postgresql')
                 and url.hostname in ('localhost', '127.0.0.1', '::1', 'demo-db')
                 and url.path == '/bos_portfolio_demo'
                 and not url.query and not url.fragment
                 and (url.port is None or 1 <= url.port <= 65535))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ValueError('DEMO_TARGET_REFUSED: use only local bos_portfolio_demo, with no connection options')
    return dsn
