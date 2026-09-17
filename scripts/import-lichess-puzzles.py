"""Explicit offline catalogue import; requires an existing zstd command, no pip packages.
Run only with permission to download: python import-lichess-puzzles.py --download OUTPUT_DIR
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

if len(sys.argv) != 3 or sys.argv[1] != '--download':
    raise SystemExit('Usage: import-lichess-puzzles.py --download OUTPUT_DIR (downloads Lichess data)')
out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
url = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'
archive = out / 'lichess_db_puzzle.csv.zst'
with urllib.request.urlopen(url, timeout=120) as source, archive.open('wb') as target:
    shutil.copyfileobj(source, target)
print('Archive downloaded', archive.stat().st_size, flush=True)
groups = {level: [] for level in ['easy', 'normal', 'hard']}
seen = set()
process = subprocess.Popen(['zstd', '-dc', str(archive)], stdout=subprocess.PIPE)
try:
    for scanned, row in enumerate(csv.DictReader(io.TextIOWrapper(process.stdout)), 1):
        tags = row['Themes'].split()
        mates = [int(t[-1]) for t in tags if t in ['mateIn1','mateIn2','mateIn3','mateIn4','mateIn5']]
        if not mates or int(row['Popularity']) < 80 or int(row['NbPlays']) < 100 or int(row['RatingDeviation']) > 100:
            continue
        rating, mate = int(row['Rating']), mates[0]
        level = ('easy' if 900 <= rating < 1400 and mate <= 2 else
                 'normal' if 1400 <= rating < 1900 and 2 <= mate <= 3 else
                 'hard' if 1900 <= rating <= 2800 and mate >= 3 else None)
        if not level or len(groups[level]) >= 10000:
            continue
        fen, moves = row['FEN'], row['Moves'].split()
        key = ' '.join(fen.split()[:4])
        if key in seen or len(moves) != mate * 2:
            continue
        seen.add(key)
        groups[level].append(dict(id='lichess-'+row['PuzzleId'], fen=fen, moves=moves,
                                  rating=rating, mate=mate, difficulty=level, themes=tags))
        if sum(map(len, groups.values())) % 3000 == 0:
            print(json.dumps({k: len(v) for k, v in groups.items()}), flush=True)
        if all(len(v) == 10000 for v in groups.values()):
            break
finally:
    process.stdout.close(); process.terminate(); process.wait()
if any(len(v) != 10000 for v in groups.values()):
    raise SystemExit('Not enough eligible puzzles: '+str({k: len(v) for k,v in groups.items()}))
payload = json.dumps(sum(groups.values(), []), separators=(',', ':')) + '\n'
(out / 'selected.json').write_text(payload, encoding='utf-8')
print(json.dumps(dict(count=30000, scanned=scanned, sha256=hashlib.sha256(payload.encode()).hexdigest())), flush=True)
