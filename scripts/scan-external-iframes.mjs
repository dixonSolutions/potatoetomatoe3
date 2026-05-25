#!/usr/bin/env node
/**
 * Lists games whose index.html embeds a remote iframe (http/https).
 * Those hits are likely to fail under strict firewalls or mixed-content rules
 * until you mirror the bundle (download-offline-games + generate-games-list).
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');

const remoteIframe = /<iframe[^>]*\ssrc=["']https?:\/\/[^"']+["']/i;

function main() {
	if (!existsSync(GAMES_ROOT)) {
		console.error('No static/games');
		process.exit(1);
	}

	const ids = readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);

	const bad = [];
	for (const id of ids) {
		const p = join(GAMES_ROOT, id, 'online', 'index.html');
		if (!existsSync(p)) continue;
		const html = readFileSync(p, 'utf-8');
		if (remoteIframe.test(html)) {
			const m = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
			bad.push({ id, src: m?.[1] ?? '(parse error)' });
		}
	}

	console.log(`Games with remote iframe src: ${bad.length} / ${ids.length}\n`);
	for (const { id, src } of bad.sort((a, b) => a.id.localeCompare(b.id))) {
		console.log(`${id}\n  ${src}`);
	}

	process.exit(bad.length > 0 ? 2 : 0);
}

main();
