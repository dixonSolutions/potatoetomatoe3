import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (potato-tomato-2) */
export const REPO_ROOT = join(__dirname, '..', '..');

/** GamesAssembly package root (automation CLIs). */
export const GAMES_ASSEMBLY_DIR = join(REPO_ROOT, 'GamesAssembly');

export const GAMES_ROOT = join(REPO_ROOT, 'static', 'games');

export const DOWNLOAD_OFFLINE_SCRIPT = join(REPO_ROOT, 'scripts', 'download-games-offline.js');

export const Y8_IMPORT_SCRIPT = join(REPO_ROOT, 'scripts', 'pull-external-sources', 'import-y8-games.mjs');

export const GENERATE_GAMES_LIST_SCRIPT = join(REPO_ROOT, 'scripts', 'generate-games-list.js');

export const SEED_OFFLINE_FROM_ONLINE_SCRIPT = join(REPO_ROOT, 'scripts', 'seed-offline-from-online.mjs');

export const PULL_EXTERNAL_SOURCES_SCRIPT = join(
	REPO_ROOT,
	'scripts',
	'pull-external-sources',
	'pull-external-sources.mjs'
);

/** `pull-games-for-offline.js` — downloader + repairs + generate-games-list. */
export const PULL_OFFLINE_ORCHESTRATOR_SCRIPT = join(
	REPO_ROOT,
	'scripts',
	'pull-offline',
	'pull-games-for-offline.js'
);
