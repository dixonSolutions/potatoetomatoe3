#!/usr/bin/env node
/**
 * Receives `/dev/perf-bench` reports from any engine (Tauri webview, WebKitGTK, Chromium, …)
 * and writes each one to disk. Dev only.
 *
 *   POST /result    a finished report; saved as <engine>-<variant>-<ms>.json with a `host`
 *                   block (load average, CPU, kernel) added at the moment it arrived
 *   GET  /env       the host snapshot on its own; the bench reads it at the start and after
 *                   every workload, so each result carries the load it ran under
 *   POST /progress  a status line from the page, echoed to stdout (and the progress log),
 *                   so a harness can tell a slow run from a dead one
 *   POST /tag       `<label>` or `<label>\n<query>`: the variant label (and extra bench query
 *                   options) for pages opened with `variant=collector`. Tauri bakes its dev
 *                   URL into the build, so a harness that changes only env vars or options
 *                   between runs sets them here rather than recompiling for a new URL.
 *
 * Usage: node scripts/perf-bench-collector.mjs [outDir]   (default: ./perf-bench-results)
 *        PERF_BENCH_PORT=18799 by default.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'perf-bench-results');
const port = Number(process.env.PERF_BENCH_PORT ?? 18799);
mkdirSync(outDir, { recursive: true });

function readText(file) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}

/** Busy share of all CPUs since the previous call (null on the first). */
let lastCpu = null;
function cpuBusySinceLast() {
	const line = readText('/proc/stat')?.split('\n')[0];
	if (!line) return null;
	const f = line.trim().split(/\s+/).slice(1).map(Number);
	const idle = f[3] + (f[4] ?? 0);
	const total = f.reduce((a, b) => a + b, 0);
	const prev = lastCpu;
	lastCpu = { idle, total };
	if (!prev || total === prev.total) return null;
	return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10;
}

/*
 * Power state matters as much as load on a laptop: WebKitGTK throttles requestAnimationFrame
 * to 30 fps whenever the power profile is `power-saver` (GLib's power-profile monitor), and
 * the profile also caps CPU/GPU clocks for every engine. Read once per snapshot.
 */
function power() {
	const sys = (p) => readText(p)?.trim() ?? null;
	let profile = null;
	try {
		profile = execFileSync('powerprofilesctl', ['get'], { timeout: 3000 }).toString().trim();
	} catch {
		/* no power-profiles-daemon */
	}
	return {
		profile,
		acOnline: sys('/sys/class/power_supply/AC/online'),
		battery: sys('/sys/class/power_supply/BAT0/capacity'),
		batteryStatus: sys('/sys/class/power_supply/BAT0/status')
	};
}

function host() {
	const cpus = os.cpus();
	return {
		power: power(),
		at: new Date().toISOString(),
		loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100),
		cpuBusyPctSinceLastSnapshot: cpuBusySinceLast(),
		cpuModel: cpus[0]?.model ?? null,
		cpuCount: cpus.length,
		memFreeMiB: Math.round(os.freemem() / 1048576),
		memTotalMiB: Math.round(os.totalmem() / 1048576),
		kernel: os.release(),
		hostname: os.hostname(),
		benchTag: currentTag,
		benchQuery: currentQuery
	};
}

const progressLog = path.join(outDir, 'progress.log');
let currentTag = process.env.PERF_BENCH_TAG ?? null;
let currentQuery = '';

createServer((req, res) => {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('access-control-allow-headers', 'content-type');
	res.setHeader('cache-control', 'no-store');
	if (req.method === 'OPTIONS') return res.writeHead(204).end();
	if (req.method === 'GET' && req.url?.startsWith('/env')) {
		res.setHeader('content-type', 'application/json');
		return res.writeHead(200).end(JSON.stringify(host()));
	}
	if (req.method !== 'POST' || !['/result', '/progress', '/tag'].includes(req.url ?? '')) {
		return res.writeHead(404).end();
	}
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		if (req.url === '/tag') {
			const [label = '', query = ''] = body.split('\n');
			currentTag = label.trim() || null;
			currentQuery = query.trim().replace(/^[?&]/, '');
			console.log(`[perf-bench] tag → ${currentTag} ${currentQuery}`);
			return res.writeHead(200).end('ok');
		}
		if (req.url === '/progress') {
			const line = `${new Date().toISOString()} ${body.slice(0, 500)}`;
			console.log(`[perf-bench] ${line}`);
			appendFileSync(progressLog, line + '\n');
			return res.writeHead(200).end('ok');
		}
		try {
			const report = JSON.parse(body);
			report.host = host();
			if (report?.env?.variant === 'collector') report.env.variant = currentTag ?? 'untagged';
			const tag = (s) => String(s ?? 'unknown').replace(/[^\w.-]/g, '_');
			const file = path.join(
				outDir,
				`${tag(report?.env?.engine)}-${tag(report?.env?.variant)}-${Date.now()}.json`
			);
			writeFileSync(file, JSON.stringify(report, null, 2));
			console.log(`[perf-bench] saved ${file}`);
			res.writeHead(200).end('ok');
		} catch (e) {
			res.writeHead(400).end(String(e));
		}
	});
}).listen(port, '127.0.0.1', () => {
	console.log(`[perf-bench] collecting on http://127.0.0.1:${port} → ${outDir}`);
});
