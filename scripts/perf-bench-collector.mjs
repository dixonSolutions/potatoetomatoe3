#!/usr/bin/env node
/**
 * Receives `/dev/perf-bench` reports from any engine (Tauri webview, Chromium, …) and
 * writes each one to disk. Dev only.
 *
 * Usage: node scripts/perf-bench-collector.mjs [outDir]   (default: ./perf-bench-results)
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'perf-bench-results');
const port = Number(process.env.PERF_BENCH_PORT ?? 18799);
mkdirSync(outDir, { recursive: true });

createServer((req, res) => {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('access-control-allow-headers', 'content-type');
	if (req.method === 'OPTIONS') return res.writeHead(204).end();
	if (req.method !== 'POST' || req.url !== '/result') return res.writeHead(404).end();
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		try {
			const report = JSON.parse(body);
			const engine = String(report?.env?.engine ?? 'unknown').replace(/[^\w.-]/g, '_');
			const file = path.join(outDir, `${engine}-${Date.now()}.json`);
			writeFileSync(file, JSON.stringify(report, null, 2));
			console.log(`[perf-bench] saved ${file}`);
			res.writeHead(200).end('ok');
		} catch (e) {
			res.writeHead(400).end(String(e));
		}
	});
}).listen(port, '127.0.0.1', () => {
	console.log(`[perf-bench] collecting on http://127.0.0.1:${port}/result → ${outDir}`);
});
