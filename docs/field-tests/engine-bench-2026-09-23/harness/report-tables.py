#!/usr/bin/python3
"""Curated Markdown tables for REPORT.md from the raw result files.

usage: report-tables.py <results-dir> <cpu.log>
Prints named sections (### TABLE name) that the report pastes in.
"""
import collections
import glob
import json
import os
import re
import statistics
import sys

rdir = sys.argv[1]
cpu_log = sys.argv[2] if len(sys.argv) > 2 else None

runs = collections.defaultdict(list)
for f in sorted(glob.glob(os.path.join(rdir, "*.json"))):
    d = json.load(open(f))
    if "env" not in d:
        continue
    d["_file"] = os.path.basename(f)
    runs[d["env"]["variant"]].append(d)

cpu = {}
if cpu_log and os.path.exists(cpu_log):
    for line in open(cpu_log):
        m = re.match(r"(\S+) cpu_s=([\d.]+) wall_s=(\d+)", line)
        if m:
            cpu[m.group(1)] = (float(m.group(2)), int(m.group(3)))


def g(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def wl(d, wid):
    for r in d["results"]:
        if r.get("workload") == wid:
            return r
    return None


def med(vals, digits=0, spread=True):
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return "–"
    m = statistics.median(vals)
    f = "%%.%df" % digits
    if not spread or len(vals) == 1:
        return f % m
    return (f + " (" + f + "–" + f + ")") % (m, min(vals), max(vals))


WL = [
    ("shrek-unity", "Shrek (Unity)"),
    ("sprites-canvas", "Canvas 2D 3k"),
    ("sprites-canvas-heavy", "Canvas 2D 10k"),
    ("sprites-webgl", "WebGL sprites 20k"),
    ("gl-heavy", "GL heavy"),
    ("gl-light", "GL light"),
]


def label(v):
    return v


def fps_table(variants, title_col="configuration"):
    out = ["| %s | n | DPR | load avg | page rAF | %s |" % (title_col, " | ".join(n for _, n in WL))]
    out.append("|---|---|---|---|---|" + "---|" * len(WL))
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        cells = [med([g(wl(d, w), "frames", "consoleOff", "fps") for d in ds], 1) for w, _ in WL]
        out.append(
            "| %s | %d | %s | %s | %s | %s |"
            % (
                label(v),
                len(ds),
                "/".join(sorted({"%g" % d["env"]["devicePixelRatio"] for d in ds})),
                med([(g(d, "hostAtStart", "loadavg") or [None])[0] for d in ds], 1, False),
                med([g(d, "baseline", "fps") for d in ds], 1, False),
                " | ".join(cells),
            )
        )
    return "\n".join(out)


def script_table(variants):
    ws = [w for w in WL if w[0] != "shrek-unity"]
    out = ["| configuration | %s |" % " | ".join(n for _, n in ws)]
    out.append("|---|" + "---|" * len(ws))
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        cells = [med([g(wl(d, w), "frames", "consoleOff", "scriptMs", "mean") for d in ds], 1) for w, _ in ws]
        out.append("| %s | %s |" % (label(v), " | ".join(cells)))
    return "\n".join(out)


def p95_table(variants):
    out = ["| configuration | %s |" % " | ".join(n for _, n in WL)]
    out.append("|---|" + "---|" * len(WL))
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        cells = [med([g(wl(d, w), "frames", "consoleOff", "frameMs", "p95") for d in ds], 0, False) for w, _ in WL]
        out.append("| %s | %s |" % (label(v), " | ".join(cells)))
    return "\n".join(out)


def console_table(variants):
    out = ["| configuration | %s |" % " | ".join(n for _, n in WL)]
    out.append("|---|" + "---|" * len(WL))
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        cells = [med([g(wl(d, w), "frames", "consoleOn", "fps") for d in ds], 1, False) for w, _ in WL]
        out.append("| %s | %s |" % (label(v), " | ".join(cells)))
    return "\n".join(out)


def latency_table(variants):
    out = [
        "| configuration | press → keydown | press → next frame: Shrek | Canvas 3k | Canvas 10k | WebGL 20k | GL heavy | GL light | bridge → next frame (Shrek) |"
    ]
    out.append("|---|---|---|---|---|---|---|---|---|")
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        keys = [g(wl(d, w), "latency", "button", "dispatchToGameKeydownMs", "p50") for d in ds for w, _ in WL]
        cells = [med([g(wl(d, w), "latency", "button", "dispatchToNextGameFrameMs", "p50") for d in ds], 1, False) for w, _ in WL]
        bridge = med([g(wl(d, "shrek-unity"), "latency", "bridge", "dispatchToNextGameFrameMs", "p50") for d in ds], 1, False)
        out.append("| %s | %s | %s | %s |" % (label(v), med(keys, 1, False), " | ".join(cells), bridge))
    return "\n".join(out)


def load_table(variants):
    out = ["| configuration | Unity cold ready (ms) | Unity warm ready (ms) | fetch 32 MB wasm (ms) | WebAssembly.compile (ms) |"]
    out.append("|---|---|---|---|---|")
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        out.append(
            "| %s | %s | %s | %s | %s |"
            % (
                label(v),
                med([g(wl(d, "shrek-unity"), "load", "readyMs") for d in ds]),
                med([g(wl(d, "shrek-unity"), "load", "warmReadyMs") for d in ds]),
                med([g(d, "wasm", "fetchMs") for d in ds]),
                med([g(d, "wasm", "compile1Ms") for d in ds] + [g(d, "wasm", "compile2Ms") for d in ds]),
            )
        )
    return "\n".join(out)


def cpu_table(variants):
    out = ["| configuration | runs with CPU data | engine CPU seconds per run | run wall seconds |"]
    out.append("|---|---|---|---|")
    for v in variants:
        ds = runs.get(v, [])
        vals = [cpu[d["_file"]] for d in ds if d["_file"] in cpu]
        if not vals:
            continue
        out.append(
            "| %s | %d | %s | %s |"
            % (label(v), len(vals), med([c for c, _ in vals], 0), med([w for _, w in vals], 0))
        )
    return "\n".join(out)


def surfaces(variants):
    out = []
    for v in variants:
        ds = runs.get(v, [])
        if not ds:
            continue
        seen = sorted({"%s %s" % (r["workload"], g(r, "surface", "backing")) for d in ds for r in d["results"] if g(r, "surface", "backing")})
        out.append("- %s: %s" % (v, ", ".join(seen)))
    return "\n".join(out)


MAIN = ["tauri-shipped", "tauri-nolowpower", "tauri-tuned", "chromium"]
VAR = [
    "v-tauri-shipped",
    "v-wk-default",
    "v-wk-nolowpower",
    "v-tauri-giomodule",
    "v-wk-nolowpower-skiacpu",
    "v-wk-nolowpower-webglgpuprocess",
    "v-wk-nolowpower-shm",
    "v-wk-nolowpower-gputhreads0",
    "v-wk-nolowpower-nodmabuf",
    "v-wk-nolowpower-nocompositing",
    "v-wk-nolowpower-canvascpu",
    "v-chromium",
]
S125 = [
    "s125-tauri-shipped",
    "s125-tauri-nolowpower",
    "s125-tauri-tuned",
    "s125-wk-nolowpower-skiacpu",
    "s125-wk-nolowpower-dprcap125",
    "s125-wk-tuned-dprcap",
    "s125-chromium",
]

print("### TABLE main-fps\n" + fps_table(MAIN) + "\n")
print("### TABLE main-p95\n" + p95_table(MAIN) + "\n")
print("### TABLE main-console\n" + console_table(MAIN) + "\n")
print("### TABLE main-script\n" + script_table(MAIN) + "\n")
print("### TABLE main-latency\n" + latency_table(MAIN) + "\n")
print("### TABLE main-load\n" + load_table(MAIN + ["v-tauri-shipped", "v-wk-nolowpower-skiacpu", "v-chromium"]) + "\n")
print("### TABLE main-cpu\n" + cpu_table(MAIN + S125) + "\n")
print("### TABLE var-fps\n" + fps_table(VAR) + "\n")
print("### TABLE var-script\n" + script_table(VAR) + "\n")
print("### TABLE s125-fps\n" + fps_table(S125) + "\n")
print("### TABLE s125-surface\n" + surfaces(S125) + "\n")
