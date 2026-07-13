#!/usr/bin/env node
/**
 * Wire Playhop URL into existing shrek-escape online shell.
 * Ensures offline/ exists (bundled copy stays git-exceptioned).
 *
 * Usage:
 *   node scripts/update-shrek-playhop.mjs
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchTextCurl, createOnlineIndexHtml } from './lib/game-shell.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GAME_DIR = join(ROOT, 'static/games/shrek-escape');
const ONLINE = join(GAME_DIR, 'online');
const OFFLINE = join(GAME_DIR, 'offline');

/** Primary Playhop title matching our game */
const PLAYHOP_APP_ID = 415567;
/** Sequel also on Playhop — imported separately by playhop scraper; listed for reference */
const PLAYHOP_APP_ID_2 = 449722;

async function resolveEmbed() {
	const pageUrl = `https://playhop.com/app/${PLAYHOP_APP_ID}`;
	const html = await fetchTextCurl(pageUrl, { referer: 'https://playhop.com/' });
	const iframe = html.match(
		/<iframe[^>]+src=["'](https:\/\/app-\d+\.games\.s3\.yandex\.net[^"']+)["']/i
	)?.[1];
	const embedUrl = (iframe || pageUrl).replace(/&amp;/g, '&');
	return { pageUrl, embedUrl, appId: PLAYHOP_APP_ID, sequelAppId: PLAYHOP_APP_ID_2 };
}

function mainOfflineEnsure() {
	mkdirSync(OFFLINE, { recursive: true });
	if (!existsSync(join(OFFLINE, 'index.html'))) {
		// If offline was wiped, seed a stub pointing users to bundled rebuild instructions.
		writeFileSync(
			join(OFFLINE, 'README-offline.txt'),
			'Offline build missing. Restore from a prior bundle or re-download via the desktop puller.\n',
			'utf-8'
		);
		console.warn('  offline/index.html missing — created placeholder note only.');
		return false;
	}
	console.log('  offline/ present (gitignored for other games; shrek-escape is allowlisted).');
	return true;
}

async function main() {
	mkdirSync(ONLINE, { recursive: true });
	mkdirSync(join(ONLINE, 'assets'), { recursive: true });

	console.log('Resolving Playhop embed for Shrek Escape…');
	const { pageUrl, embedUrl, appId, sequelAppId } = await resolveEmbed();
	console.log(`  app ${appId} → ${embedUrl.slice(0, 100)}…`);

	const metaPath = join(ONLINE, 'metadata.json');
	const prev = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
	const metadata = {
		...prev,
		id: 'shrek-escape',
		name: prev.name || 'Shrek: Escape from the Swamp',
		author: prev.author || 'Third-party / Unity WebGL',
		description:
			prev.description ||
			'Help Shrek escape the swamp in this Unity WebGL adventure. Play online via Playhop or use the bundled offline copy.',
		thumbnail: prev.thumbnail || '/games/shrek-escape/online/assets/thumbnail.png',
		category: prev.category || 'action',
		engine: 'unity',
		onlineEmbedUrl: embedUrl,
		embedPageUrl: pageUrl,
		playhopAppId: appId,
		playhopSequelAppId: sequelAppId,
		bundledOffline: true,
		pullStrategy: prev.pullStrategy || 'embed',
		sourcePortal: 'playhop'
	};

	writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
	writeFileSync(
		join(ONLINE, 'index.html'),
		createOnlineIndexHtml(embedUrl, metadata.name),
		'utf-8'
	);

	const offlineOk = mainOfflineEnsure();
	console.log(`Updated shrek-escape online → Playhop app ${appId}`);
	console.log(`Offline ready: ${offlineOk}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
