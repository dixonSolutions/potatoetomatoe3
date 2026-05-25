import { spawn } from 'node:child_process';
import { DOWNLOAD_OFFLINE_SCRIPT, REPO_ROOT } from '../paths.js';

export function runDownloadOfflineScript(args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [DOWNLOAD_OFFLINE_SCRIPT, ...args], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			env: process.env
		});
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}
