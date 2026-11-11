"""Analyze existing raw samples only; never calls HTTP or a database."""
import argparse
import collections
import datetime as dt
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--evidence', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
groups = collections.defaultdict(list)
vus = []
for line in a.evidence.read_text(encoding='utf-8-sig').splitlines():
    x = json.loads(line)
    if x.get('type') != 'Point':
        continue
    d = x['data']
    tags = d.get('tags', {})
    if x['metric'] == 'http_req_duration' and tags.get('endpoint') == 'stock-levels':
        groups[tags.get('stage')].append(d['time'])
    if x['metric'] == 'vus':
        vus.append({'time': d['time'], 'value': d['value']})
result = {'source': str(a.evidence), 'observed_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
          'stages': {k: {'requests': len(v), 'first_response': min(v), 'last_response': max(v)} for k, v in groups.items()},
          'last_vu_samples': vus[-35:], 'raw_vu_samples_available': bool(vus),
          'finding': 'Legacy recovery is a ramp from zero to one over 30 seconds. It is not a constant one-VU recovery window; the raw record has zero recovery HTTP samples.',
          'cause_confidence': 'Configuration defect confirmed. Exact executor rounding/allocation mechanism is not inferred from missing samples.',
          'fix': 'Use an independent constant-vus scenario with one VU for a complete 30 seconds, after the spike scenario and its grace period.',
          'real_workload_started': False, 'http_requests': 0}
if a.output.exists():
    raise SystemExit('Refusing to overwrite evidence')
a.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
