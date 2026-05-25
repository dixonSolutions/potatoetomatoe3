import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { GAMES_ASSEMBLY_DIR, REPO_ROOT } from '../paths.js';

/**
 * Run `node <scriptAbsPath> ...args` with cwd = repo root; prefix each stdout/stderr line
 * so two concurrent processes read like a split log: `download    | …` / `fix         | …`.
 */
export function runRepoNodeScriptPrefixed(
	scriptAbsPath: string,
	args: string[] = [],
	columnLabel: string
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptAbsPath, ...args], {
			cwd: REPO_ROOT,
			env: process.env
		});
		const label = columnLabel.length > 14 ? columnLabel.slice(0, 14) : columnLabel;
		const pad = label.padEnd(14, ' ');

		function pipeStream(stream: NodeJS.ReadableStream | null): void {
			if (!stream) return;
			const rl = createInterface({ input: stream, crlfDelay: Infinity });
			rl.on('line', (line) => {
				console.log(`${pad} | ${line}`);
			});
		}

		pipeStream(child.stdout);
		pipeStream(child.stderr);
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

/**
 * Run `pnpm --dir GamesAssembly exec tsx src/cli/<cliFile> ...args` from repo root with prefixed lines.
 */
export function runGamesAssemblyTsxPrefixed(
	cliFile: string,
	args: string[],
	columnLabel: string
): Promise<number> {
	return new Promise((resolve, reject) => {
		const script = join('src', 'cli', cliFile);
		const child = spawn(
			'pnpm',
			['--dir', GAMES_ASSEMBLY_DIR, 'exec', 'tsx', script, ...args],
			{
				cwd: REPO_ROOT,
				env: process.env,
				shell: false
			}
		);
		const label = columnLabel.length > 14 ? columnLabel.slice(0, 14) : columnLabel;
		const pad = label.padEnd(14, ' ');

		function pipeStream(stream: NodeJS.ReadableStream | null): void {
			if (!stream) return;
			const rl = createInterface({ input: stream, crlfDelay: Infinity });
			rl.on('line', (line) => {
				console.log(`${pad} | ${line}`);
			});
		}

		pipeStream(child.stdout);
		pipeStream(child.stderr);
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

/** `pnpm --dir GamesAssembly exec tsx src/cli/<cliFile> ...args` with stdio inherited. */
export function runGamesAssemblyTsxInherited(cliFile: string, args: string[] = []): Promise<number> {
	return new Promise((resolve, reject) => {
		const script = join('src', 'cli', cliFile);
		const child = spawn('pnpm', ['--dir', GAMES_ASSEMBLY_DIR, 'exec', 'tsx', script, ...args], {
			cwd: REPO_ROOT,
			env: process.env,
			stdio: 'inherit',
			shell: false
		});
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}
