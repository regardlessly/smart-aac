"""One-shot maintenance script: drop cctv_snapshots_old and VACUUM the DB.

Run ONLY when the backend is stopped:
    python backend/scripts/vacuum_db.py

This reclaims the ~150-230 GB that was occupied by the old blob-filled table.
VACUUM rewrites the entire database file — it may take 30-60 min.
The backend MUST be offline for the duration (SQLite allows only one writer).

Safety checks:
  - Refuses to run if cctv_snapshots_old does not exist (nothing to drop).
  - Prints size before and after so you can verify reclaim.
"""

import os
import sqlite3
import sys
import time

# ── Locate the database ──────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
# Default DB path (matches Flask config)
DEFAULT_DB = os.path.join(BACKEND_DIR, 'smart_aac.db')
DB_PATH = os.environ.get('DATABASE_PATH', DEFAULT_DB)

if not os.path.exists(DB_PATH):
    print(f'ERROR: Database not found at {DB_PATH}')
    print('Set DATABASE_PATH env var if your DB is elsewhere.')
    sys.exit(1)

size_before = os.path.getsize(DB_PATH)
print(f'Database: {DB_PATH}')
print(f'Size before: {size_before / (1024**3):.2f} GB  ({size_before:,} bytes)')

con = sqlite3.connect(DB_PATH, timeout=300)
cur = con.cursor()

# ── Check cctv_snapshots_old exists ─────────────────────────────────────────
cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='cctv_snapshots_old'")
if not cur.fetchone():
    print('\ncctv_snapshots_old does not exist — nothing to drop.')
    print('(Either already dropped or rename trick was not used.)')
    con.close()
    # Still offer to VACUUM
    answer = input('\nVACUUM the database anyway? (y/N): ').strip().lower()
    if answer != 'y':
        print('Aborted.')
        sys.exit(0)
    con = sqlite3.connect(DB_PATH, timeout=300)
    cur = con.cursor()
else:
    print('\nDropping cctv_snapshots_old ...')
    cur.execute('DROP TABLE cctv_snapshots_old')
    con.commit()
    print('Done. Now running VACUUM (this may take 30-60 minutes)...')

# ── VACUUM ───────────────────────────────────────────────────────────────────
print('VACUUM started at', time.strftime('%H:%M:%S'))
con.execute('PRAGMA journal_mode=WAL')   # ensure WAL is off during vacuum
con.execute('PRAGMA journal_mode=DELETE')
con.isolation_level = None               # autocommit required for VACUUM
cur.execute('VACUUM')
con.close()

size_after = os.path.getsize(DB_PATH)
reclaimed = size_before - size_after
print(f'\nVACUUM complete at {time.strftime("%H:%M:%S")}')
print(f'Size after:  {size_after / (1024**3):.2f} GB  ({size_after:,} bytes)')
print(f'Reclaimed:   {reclaimed / (1024**3):.2f} GB')
print('\nDone! You can now restart the backend.')
