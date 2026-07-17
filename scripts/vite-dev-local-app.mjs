#!/usr/bin/env node
/**
 * Tauri beforeDevCommand entry — sets PUBLIC_OFFLINE_DEPLOYMENT reliably.
 * Inline `VAR=value cmd` is easy for the CLI to drop when it wraps `sh -c`.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.PUBLIC_OFFLINE_DEPLOYMENT =
	process.env.PUBLIC_OFFLINE_DEPLOYMENT?.trim() || 'local-app';

const child = spawn('pnpm', ['exec', 'vite', 'dev', ...process.argv.slice(2)], {
	cwd: root,
	env: process.env,
	stdio: 'inherit',
	shell: false
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
