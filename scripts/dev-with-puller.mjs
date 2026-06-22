#!/usr/bin/env node
/**
 * Start the puller backend + another command (vite or tauri dev).
 * Kills puller when the main process exits.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const mainArgs = process.argv.slice(2);

if (mainArgs.length === 0) {
	console.error('Usage: node scripts/dev-with-puller.mjs <command> [args...]');
	process.exit(1);
}

const puller = spawn('pnpm', ['--filter', '@potatotomato/puller', 'start'], {
	cwd: repoRoot,
	stdio: 'inherit',
	env: process.env
});

puller.on('error', (err) => {
	console.warn('[dev] Puller failed to start:', err.message);
	console.warn('[dev] Offline download will be unavailable until you run: pnpm puller:start');
});

const main = spawn(mainArgs[0], mainArgs.slice(1), {
	cwd: repoRoot,
	stdio: 'inherit',
	env: process.env,
	shell: true
});

function shutdown(code = 0) {
	try {
		puller.kill('SIGTERM');
	} catch {
		// ignore
	}
	process.exit(code);
}

main.on('error', (err) => {
	console.error('[dev] Main process failed:', err.message);
	shutdown(1);
});

main.on('exit', (code) => shutdown(code ?? 0));

process.on('SIGINT', () => {
	try {
		main.kill('SIGINT');
	} catch {
		shutdown(130);
	}
});

process.on('SIGTERM', () => shutdown(143));
