import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const MAX_BUFFER_LINES = 400;
const REDRAW_MS = 55;

function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function truncToWidth(s: string, w: number): string {
	const plain = stripAnsi(s);
	if (plain.length <= w) return plain;
	if (w <= 1) return '…';
	return plain.slice(0, w - 1) + '…';
}

function padTo(s: string, w: number): string {
	if (s.length >= w) return s.slice(0, w);
	return s + ' '.repeat(w - s.length);
}

function attachChildLines(child: ChildProcess, onLine: (line: string) => void): Promise<number> {
	return new Promise((resolve, reject) => {
		for (const stream of [child.stdout, child.stderr]) {
			if (!stream) continue;
			const rl = createInterface({ input: stream, crlfDelay: Infinity });
			rl.on('line', (line) => onLine(line));
		}
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

export type SplitLaneLabels = { left: string; right: string };

export type RunSplitParallelOptions = SplitLaneLabels & {
	/** When false or stdout is not a TTY (or too narrow), use interleaved prefixed lines. */
	useSplitUi: boolean;
	/** Minimum terminal width to use split UI. */
	minCols?: number;
	runLeft: (emit: (line: string) => void) => Promise<number>;
	runRight: (emit: (line: string) => void) => Promise<number>;
};

/**
 * Run two async jobs in parallel. With split UI: redraws a two-column “terminal split” while
 * **both** are active; when **either** finishes first, the surviving lane’s output uses the **full**
 * terminal width from then on (so logs aren’t squeezed into half a screen anymore).
 */
export async function runSplitParallelLanes(opts: RunSplitParallelOptions): Promise<[number, number]> {
	const minCols = opts.minCols ?? 72;
	const out = process.stdout;
	const canSplit = opts.useSplitUi && Boolean(out.isTTY) && (out.columns ?? 0) >= minCols;

	if (!canSplit) {
		const L = opts.left.length > 12 ? opts.left.slice(0, 12) : opts.left;
		const R = opts.right.length > 12 ? opts.right.slice(0, 12) : opts.right;
		const pL = L.padEnd(12, ' ');
		const pR = R.padEnd(12, ' ');
		const [a, b] = await Promise.all([
			opts.runLeft((line) => console.log(`${pL} | ${line}`)),
			opts.runRight((line) => console.log(`${pR} | ${line}`))
		]);
		return [a, b];
	}

	type Mode = 'split' | 'full-left' | 'full-right';
	let mode: Mode = 'split';
	const leftBuf: string[] = [];
	const rightBuf: string[] = [];
	let redrawTimer: ReturnType<typeof setTimeout> | null = null;
	let leftSettled = false;
	let rightSettled = false;
	let splitUiEnded = false;

	function finishSplitOnce(): void {
		if (splitUiEnded) return;
		splitUiEnded = true;
		if (redrawTimer) {
			clearTimeout(redrawTimer);
			redrawTimer = null;
		}
		out.write('\x1b[?25h\n');
	}

	function drawSplit(): void {
		if (mode !== 'split') return;
		const rows = out.rows ?? 24;
		const cols = out.columns ?? 80;
		const headerRows = 2;
		const paneH = Math.max(4, Math.min(MAX_BUFFER_LINES, rows - headerRows - 1));
		const gutter = 3;
		const wL = Math.max(18, Math.floor(cols / 2) - Math.floor(gutter / 2));
		const wR = Math.max(18, cols - wL - gutter);

		const L = leftBuf.slice(-paneH);
		const R = rightBuf.slice(-paneH);
		const lines: string[] = [];
		lines.push('\x1b[H\x1b[2J\x1b[?25l');
		const headL = padTo(truncToWidth(opts.left, wL), wL);
		const headR = padTo(truncToWidth(opts.right, wR), wR);
		lines.push(`${headL} │ ${headR}`);
		lines.push(`${'─'.repeat(wL)}─┼─${'─'.repeat(wR)}`);
		const n = Math.max(L.length, R.length, paneH);
		for (let i = 0; i < n && i < paneH; i++) {
			const l = padTo(truncToWidth(L[i] ?? '', wL), wL);
			const r = padTo(truncToWidth(R[i] ?? '', wR), wR);
			lines.push(`${l} │ ${r}`);
		}
		out.write(lines.join('\n'));
	}

	function scheduleRedraw(): void {
		if (mode !== 'split') return;
		if (redrawTimer) return;
		redrawTimer = setTimeout(() => {
			redrawTimer = null;
			drawSplit();
		}, REDRAW_MS);
	}

	function pushLeft(line: string): void {
		if (mode === 'split') {
			leftBuf.push(line);
			if (leftBuf.length > MAX_BUFFER_LINES) leftBuf.shift();
			scheduleRedraw();
		} else if (mode === 'full-left') {
			console.log(line);
		}
	}

	function pushRight(line: string): void {
		if (mode === 'split') {
			rightBuf.push(line);
			if (rightBuf.length > MAX_BUFFER_LINES) rightBuf.shift();
			scheduleRedraw();
		} else if (mode === 'full-right') {
			console.log(line);
		}
	}

	function onLeftSettled(code: number): void {
		leftSettled = true;
		if (mode === 'split') {
			if (rightSettled) {
				finishSplitOnce();
			} else {
				mode = 'full-right';
				finishSplitOnce();
				console.log(
					`\n── ${opts.left} finished (exit ${code}) — ${opts.right} continues (full width) —\n`
				);
			}
			return;
		}
		if (mode === 'full-left') {
			console.log(`\n── ${opts.left} finished (exit ${code}).\n`);
		}
	}

	function onRightSettled(code: number): void {
		rightSettled = true;
		if (mode === 'split') {
			if (leftSettled) {
				finishSplitOnce();
			} else {
				mode = 'full-left';
				finishSplitOnce();
				console.log(
					`\n── ${opts.right} finished (exit ${code}) — ${opts.left} continues (full width) —\n`
				);
			}
			return;
		}
		if (mode === 'full-right') {
			console.log(`\n── ${opts.right} finished (exit ${code}).\n`);
		}
	}

	const onResize = (): void => {
		if (mode === 'split') scheduleRedraw();
	};
	if (out.isTTY) out.on('resize', onResize);

	drawSplit();

	const leftP = opts
		.runLeft(pushLeft)
		.then((c) => {
			onLeftSettled(c);
			return c;
		})
		.catch((e) => {
			onLeftSettled(1);
			throw e;
		});

	const rightP = opts
		.runRight(pushRight)
		.then((c) => {
			onRightSettled(c);
			return c;
		})
		.catch((e) => {
			onRightSettled(1);
			throw e;
		});

	try {
		return await Promise.all([leftP, rightP]);
	} finally {
		if (out.isTTY) out.off('resize', onResize);
		if (!splitUiEnded && mode === 'split') finishSplitOnce();
	}
}

/** Spawn `node scriptPath ...args` from `cwd`, emitting each stdout/stderr line. */
export function spawnNodeScriptLines(
	execPath: string,
	scriptPath: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	emit: (line: string) => void
): Promise<number> {
	const child = spawn(execPath, [scriptPath, ...args], {
		cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	return attachChildLines(child, emit);
}

/** Spawn `pnpm --dir gaDir exec tsx src/cli/<cliFile> ...args` from repo root. */
export function spawnGamesAssemblyTsxLines(
	pnpmDir: string,
	tsxRelScript: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	emit: (line: string) => void
): Promise<number> {
	const child = spawn('pnpm', ['--dir', pnpmDir, 'exec', 'tsx', tsxRelScript, ...args], {
		cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: false
	});
	return attachChildLines(child, emit);
}
