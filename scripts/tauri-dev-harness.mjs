#!/usr/bin/env node
/**
 * Launch a development-only Tauri harness window.
 * Puller is owned by Tauri (src-tauri/src/lib.rs) — do not pre-spawn it here.
 *
 * Usage: node scripts/tauri-dev-harness.mjs <console-test|puller-test>
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const harness = process.argv[2];
const allowed = new Set(['console-test', 'puller-test']);

if (!allowed.has(harness)) {
	console.error(
		`Usage: node scripts/tauri-dev-harness.mjs <console-test|puller-test>\n` +
			`Received: ${harness ?? '(none)'}`
	);
	process.exit(1);
}

if (process.env.POTATO_TOMATO_DEV_HARNESS && process.env.POTATO_TOMATO_DEV_HARNESS !== harness) {
	console.error(
		`POTATO_TOMATO_DEV_HARNESS is already set to "${process.env.POTATO_TOMATO_DEV_HARNESS}". ` +
			`Refuse to nest harness launches.`
	);
	process.exit(1);
}

const configPath = path.join('src-tauri', `tauri.${harness}.conf.json`);

const env = {
	...process.env,
	POTATO_TOMATO_DEV_HARNESS: harness,
	PUBLIC_OFFLINE_DEPLOYMENT: process.env.PUBLIC_OFFLINE_DEPLOYMENT || 'local-app',
	/* Avoid tray-hide stranding the harness during iterative debugging. */
	POTATO_TOMATO_NO_CLOSE_TO_TRAY: process.env.POTATO_TOMATO_NO_CLOSE_TO_TRAY || '1'
};

console.log(`[harness] launching ${harness} via tauri dev --config ${configPath}`);
console.log(`[harness] puller lifecycle owned by Tauri (do not run pnpm dev / puller:start in parallel)`);

const child = spawn('pnpm', ['tauri', 'dev', '--config', configPath], {
	cwd: repoRoot,
	stdio: 'inherit',
	env,
	shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

child.on('error', (err) => {
	console.error('[harness] failed to spawn tauri:', err.message);
	process.exit(1);
});
