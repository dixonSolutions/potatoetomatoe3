import { spawn } from 'node:child_process';
import { REPO_ROOT } from '../paths.js';

/** Run `node <scriptAbsPath> ...args` with cwd = repo root. */
export function runRepoNodeScript(scriptAbsPath: string, args: string[] = []): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptAbsPath, ...args], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			env: process.env
		});
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}
