#!/usr/bin/env node
/**
 * Recommended order for a clean catalog:
 *
 *   1. (optional) node scripts/dedupe-games.mjs           # dry-run
 *   2. (optional) node scripts/dedupe-games.mjs --apply   # quarantine URL duplicates
 *   3. This script: pull mirrors + promote + regenerate
 *
 * Usage:
 *   node scripts/run-catalog-pipeline.mjs
 *   node scripts/run-catalog-pipeline.mjs --dedupe-apply   # runs dedupe --apply first then make-all-local
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const dedupeApply = process.argv.includes('--dedupe-apply');

if (dedupeApply) {
	console.log('0/3 dedupe-games.mjs --apply…\n');
	execSync('node scripts/dedupe-games.mjs --apply', { cwd: root, stdio: 'inherit' });
	console.log('\n');
}

execSync('node scripts/make-all-local.mjs', { cwd: root, stdio: 'inherit' });
