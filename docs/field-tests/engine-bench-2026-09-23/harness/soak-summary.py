#!/usr/bin/python3
"""Summarise the full-speed soak (matrices/tuning-soak.txt): per launch, whether the GIO module
ran in the web process, crashes in the app logs, Unity starts and Shrek's frame rate.

usage: BENCH_DIR=<dir> soak-summary.py
"""
import glob
import json
import os
import re
import statistics

B = os.environ.get('BENCH_DIR', os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/tmp'), 'pt-engine-bench'))
logs = sorted(glob.glob(B + '/logs/tauri-t-soak-*.log'))
res = sorted(glob.glob(B + '/results/tauri-webkitgtk-t-soak-*.json'))
crash_pat = re.compile(r'web process (crashed|exceeded|terminated)|GLib-ERROR|getauxval|SIGSEGV|Aborted', re.I)
module_pat = re.compile(r'module running in web process: (.*)')
crashes = []
modules = 0
wraps = set()
for f in logs:
    t = open(f, errors='replace').read()
    m = module_pat.findall(t)
    if m:
        modules += 1
        for line in m:
            w = re.search(r'wraps=(\S+)', line)
            if w:
                wraps.add(w.group(1))
    for line in t.splitlines():
        if crash_pat.search(line):
            crashes.append((os.path.basename(f), line.strip()[:200]))
cold, warm, fps = [], [], []
starts = 0
for f in res:
    r = json.load(open(f))
    for w in r['results']:
        if w.get('workload') != 'shrek-unity':
            continue
        ld = w.get('load') or {}
        if ld.get('readyMs'):
            cold.append(ld['readyMs'])
            starts += 1
        if ld.get('warmReadyMs'):
            warm.append(ld['warmReadyMs'])
            starts += 1
        v = ((w.get('frames') or {}).get('consoleOff') or {}).get('fps')
        if v:
            fps.append(v)
print('launches (logs):', len(logs), 'results:', len(res))
print('module active in web process:', modules, 'wraps:', sorted(wraps))
print('unity starts:', starts, 'cold ready ms median', statistics.median(cold) if cold else None,
      'range', (min(cold), max(cold)) if cold else None)
print('warm ready ms median', statistics.median(warm) if warm else None)
print('shrek fps median', statistics.median(fps) if fps else None, 'range', (min(fps), max(fps)) if fps else None)
print('crash lines:', len(crashes))
for c in crashes[:20]:
    print('  ', c)
