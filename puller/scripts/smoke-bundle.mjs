#!/usr/bin/env node

import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const pullerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pullerRoot, '..');
const binary =
	process.env.PULLER_BINARY ??
	path.join(repoRoot, 'src-tauri', 'binaries', 'puller-sidecar-x86_64-unknown-linux-gnu');
const catalogDir = process.env.CATALOG_DIR ?? path.join(repoRoot, 'static', 'games');
const gamesDataDir = process.env.GAMES_DATA_DIR ?? catalogDir;

async function findFreePort() {
	return await new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (!address || typeof address === 'string') {
				probe.close();
				reject(new Error('Could not reserve a smoke-test port'));
				return;
			}
			const port = address.port;
			probe.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

async function waitForHealth(baseUrl, processHandle) {
	const deadline = Date.now() + 15_000;
	let lastError = 'no response';
	while (Date.now() < deadline) {
		if (processHandle.exitCode !== null) {
			throw new Error(`puller exited before health check (code ${processHandle.exitCode})`);
		}
		try {
			const response = await fetch(`${baseUrl}/api/offline/health`, {
				signal: AbortSignal.timeout(1_000)
			});
			const body = await response.text();
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${body}`);
			}
			const parsed = JSON.parse(body);
			if (parsed.ok !== true) {
				throw new Error(`health response was not ok: ${body}`);
			}
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw new Error(`puller health timeout: ${lastError}`);
}

async function assertProxyRoute(baseUrl, route) {
	const response = await fetch(`${baseUrl}${route}`, {
		signal: AbortSignal.timeout(2_000)
	});
	const body = await response.text();
	if (response.status !== 404 || !body.includes('Game not in catalog')) {
		throw new Error(
			`proxy route ${route} failed binding smoke test: HTTP ${response.status}: ${body}`
		);
	}
}

await access(binary);
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const pullerProcess = spawn(binary, [], {
	cwd: repoRoot,
	env: {
		...process.env,
		CATALOG_DIR: catalogDir,
		GAMES_DATA_DIR: gamesDataDir,
		PULLER_PORT: String(port)
	},
	stdio: 'inherit'
});

try {
	await waitForHealth(baseUrl, pullerProcess);
	await assertProxyRoute(baseUrl, '/api/game-live/puller-smoke-missing');
	await assertProxyRoute(baseUrl, '/api/unity-play/puller-smoke-missing');
	console.log('[puller smoke] health and proxy routes passed');
} finally {
	if (pullerProcess.exitCode === null) {
		pullerProcess.kill('SIGTERM');
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				pullerProcess.kill('SIGKILL');
				resolve();
			}, 2_000);
			pullerProcess.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}
