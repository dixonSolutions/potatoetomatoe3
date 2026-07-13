#!/usr/bin/env node
/**
 * Reclaim local catalog thumbnail disk by switching oversized budgets to remote URLs.
 *
 * Only converts games that already have metadata.thumbnailRemote.
 *
 * Usage:
 *   node scripts/prune-catalog-thumbs.mjs --dry-run
 *   node scripts/prune-catalog-thumbs.mjs
 *   node scripts/prune-catalog-thumbs.mjs --budget-mb 48
 */

import { pruneLocalThumbsToBudget, measureLocalThumbBytes, getThumbBudgetConfig, writeThumbBudgetLedger } from './lib/thumb-budget.mjs';

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? Number(a[i + 1]) : fallback;
	};
	return {
		dryRun: a.includes('--dry-run'),
		budgetMb: num('--budget-mb', 0),
		help: a.includes('--help') || a.includes('-h')
	};
}

function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/prune-catalog-thumbs.mjs [--dry-run] [--budget-mb N]
Env: CATALOG_THUMB_BUDGET_MB, CATALOG_THUMB_MAX_SINGLE_KB`);
		process.exit(0);
	}
	const budgetBytes =
		opts.budgetMb > 0 ? Math.floor(opts.budgetMb * 1024 * 1024) : getThumbBudgetConfig().budgetBytes;
	const before = measureLocalThumbBytes();
	console.log(
		`Local thumbs: ${(before.totalBytes / 1024 / 1024).toFixed(1)} MiB in ${before.files} files (budget ${(budgetBytes / 1024 / 1024).toFixed(1)} MiB)`
	);
	const result = pruneLocalThumbsToBudget({ dryRun: opts.dryRun, budgetBytes });
	console.log(
		`${opts.dryRun ? 'Would free' : 'Freed'} ${(result.freedBytes / 1024 / 1024).toFixed(1)} MiB by converting ${result.removed} covers to remote URLs.`
	);
	console.log(`Remaining: ${(result.remainingBytes / 1024 / 1024).toFixed(1)} MiB`);
	writeThumbBudgetLedger({ lastPrune: result });
}

main();
