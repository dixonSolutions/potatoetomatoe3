import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES_ROOT } from '../paths.js';
import { runGenerateGamesList } from './register-catalog.js';

export type GameMetadata = {
	id: string;
	name: string;
	author: string;
	description: string;
	thumbnail: string;
	category: string;
};

function escapeHtmlAttr(s: string): string {
	return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '').replace(/>/g, '');
}

/** Same shell shape as `import-y8-games.mjs` (iframe + full-viewport CSS). */
export function createOnlineIndexHtml(embedUrl: string, title: string): string {
	const safeTitle = String(title || 'Game')
		.replace(/</g, '')
		.replace(/>/g, '')
		.slice(0, 120);
	const safeSrc = escapeHtmlAttr(embedUrl);
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; }
        .game-iframe { width: 100%; height: 100%; border: none; display: block; }
    </style>
</head>
<body>
    <iframe class="game-iframe" id="game-area" src="${safeSrc}" scrolling="none" allowfullscreen></iframe>
</body>
</html>
`;
}

export type AddGameToCatalogOptions = {
	gameId: string;
	name: string;
	iframeSrc: string;
	description?: string;
	author?: string;
	category?: string;
	/** App path e.g. `/games/<id>/online/assets/thumb.png` */
	thumbnail?: string;
};

/**
 * Creates `static/games/<id>/{shared,online}/`, writes metadata + online shell, registers via generate-games-list.
 * Use after you know the embed URL (e.g. manual port or custom importer).
 */
export async function addGameToCatalog(opts: AddGameToCatalogOptions): Promise<void> {
	const {
		gameId,
		name,
		iframeSrc,
		description = '',
		author = 'manual',
		category = 'arcade',
		thumbnail
	} = opts;

	const onlineDir = join(GAMES_ROOT, gameId, 'online');
	const assetsDir = join(onlineDir, 'assets');
	const sharedDir = join(GAMES_ROOT, gameId, 'shared');
	mkdirSync(sharedDir, { recursive: true });
	mkdirSync(assetsDir, { recursive: true });
	writeFileSync(join(assetsDir, '.gitkeep'), '');

	const thumbRel = thumbnail ?? `/games/${gameId}/online/assets/thumb.png`;

	const metadata: GameMetadata = {
		id: gameId,
		name,
		author,
		description: description.slice(0, 4000),
		thumbnail: thumbRel,
		category
	};

	writeFileSync(join(onlineDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
	writeFileSync(join(onlineDir, 'index.html'), createOnlineIndexHtml(iframeSrc, name), 'utf-8');

	const code = await runGenerateGamesList();
	if (code !== 0) {
		throw new Error(`generate-games-list exited with ${code}`);
	}
}
