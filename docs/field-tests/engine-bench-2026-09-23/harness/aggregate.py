#!/usr/bin/python3
"""Aggregate bench reports: median [min–max] per (engine, variant) across reps, as
Markdown tables.

usage: aggregate.py [--rep-prefix X] <result.json>...
"""
import collections
import json
import statistics
import sys

files = [f for f in sys.argv[1:] if f.endswith(".json")]
runs = collections.defaultdict(list)
for f in files:
    d = json.load(open(f))
    if "env" not in d:
        continue
    key = (d["env"]["engine"], d["env"]["variant"])
    runs[key].append(d)


def g(d, *path):
    for p in path:
        if d is None:
            return None
        if isinstance(d, dict):
            d = d.get(p)
        else:
            return None
    return d


def fmt(vals, digits=1):
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return "–"
    m = statistics.median(vals)
    f = "%%.%df" % digits
    if len(vals) == 1:
        return f % m
    return (f + " [" + f + "–" + f + "]") % (m, min(vals), max(vals))


def workload(d, wid):
    for r in d["results"]:
        if r.get("workload") == wid:
            return r
    return None


order = sorted(runs.keys())
wids = []
for k in order:
    for d in runs[k]:
        for r in d["results"]:
            if r.get("workload") not in wids:
                wids.append(r.get("workload"))

print("### Runs\n")
print("| engine / variant | n | DPR | baseline rAF fps | load avg (1 min) at start | power |")
print("|---|---|---|---|---|---|")
for k in order:
    ds = runs[k]
    print(
        "| %s / %s | %d | %s | %s | %s | %s |"
        % (
            k[0],
            k[1],
            len(ds),
            ",".join(sorted({str(d["env"]["devicePixelRatio"]) for d in ds})),
            fmt([g(d, "baseline", "fps") for d in ds]),
            fmt([(g(d, "hostAtStart", "loadavg") or [None])[0] for d in ds], 2),
            ",".join(sorted({"%s/%s" % (g(d, "hostAtStart", "power", "profile"), "AC" if g(d, "hostAtStart", "power", "acOnline") == "1" else "bat") for d in ds})),
        )
    )

print("\n### Frame rate, console hidden (fps, median [min–max] over runs)\n")
print("| engine / variant | " + " | ".join(wids) + " |")
print("|---|" + "---|" * len(wids))
for k in order:
    ds = runs[k]
    cells = [fmt([g(workload(d, w), "frames", "consoleOff", "fps") for d in ds]) for w in wids]
    print("| %s / %s | %s |" % (k[0], k[1], " | ".join(cells)))

print("\n### Frame time p95, console hidden (ms)\n")
print("| engine / variant | " + " | ".join(wids) + " |")
print("|---|" + "---|" * len(wids))
for k in order:
    ds = runs[k]
    cells = [fmt([g(workload(d, w), "frames", "consoleOff", "frameMs", "p95") for d in ds]) for w in wids]
    print("| %s / %s | %s |" % (k[0], k[1], " | ".join(cells)))

print("\n### Script time per frame, mean (ms; sprite and GL scenes)\n")
sw = [w for w in wids if w != "shrek-unity"]
print("| engine / variant | " + " | ".join(sw) + " |")
print("|---|" + "---|" * len(sw))
for k in order:
    ds = runs[k]
    cells = [fmt([g(workload(d, w), "frames", "consoleOff", "scriptMs", "mean") for d in ds], 2) for w in sw]
    print("| %s / %s | %s |" % (k[0], k[1], " | ".join(cells)))

has_on = any(g(workload(d, w), "frames", "consoleOn") for k in order for d in runs[k] for w in wids)
if has_on:
    print("\n### Frame rate, console shown (fps)\n")
    print("| engine / variant | " + " | ".join(wids) + " |")
    print("|---|" + "---|" * len(wids))
    for k in order:
        ds = runs[k]
        cells = [fmt([g(workload(d, w), "frames", "consoleOn", "fps") for d in ds]) for w in wids]
        print("| %s / %s | %s |" % (k[0], k[1], " | ".join(cells)))

has_lat = any(g(workload(d, w), "latency") for k in order for d in runs[k] for w in wids)
if has_lat:
    for kind in ("button", "joystick", "bridge"):
        print("\n### Latency, console %s: dispatch → game keydown / → next game frame (ms, p50)\n" % kind)
        print("| engine / variant | " + " | ".join(wids) + " |")
        print("|---|" + "---|" * len(wids))
        for k in order:
            ds = runs[k]
            cells = []
            for w in wids:
                a = fmt([g(workload(d, w), "latency", kind, "dispatchToGameKeydownMs", "p50") for d in ds])
                b = fmt([g(workload(d, w), "latency", kind, "dispatchToNextGameFrameMs", "p50") for d in ds])
                cells.append("–" if a == "–" and b == "–" else "%s / %s" % (a, b))
            print("| %s / %s | %s |" % (k[0], k[1], " | ".join(cells)))

print("\n### Load time\n")
print("| engine / variant | Unity cold ready (ms) | Unity warm ready (ms) | wasm fetch 32 MB (ms) | WebAssembly.compile (ms) | 2nd compile (ms) |")
print("|---|---|---|---|---|---|")
for k in order:
    ds = runs[k]
    print(
        "| %s / %s | %s | %s | %s | %s | %s |"
        % (
            k[0],
            k[1],
            fmt([g(workload(d, "shrek-unity"), "load", "readyMs") for d in ds], 0),
            fmt([g(workload(d, "shrek-unity"), "load", "warmReadyMs") for d in ds], 0),
            fmt([g(d, "wasm", "fetchMs") for d in ds], 0),
            fmt([g(d, "wasm", "compile1Ms") for d in ds], 0),
            fmt([g(d, "wasm", "compile2Ms") for d in ds], 0),
        )
    )

print("\n### Game canvas backing store\n")
for k in order:
    ds = runs[k]
    seen = sorted({"%s:%s" % (r.get("workload"), g(r, "surface", "backing")) for d in ds for r in d["results"]})
    print("- %s / %s: %s" % (k[0], k[1], ", ".join(seen)))
