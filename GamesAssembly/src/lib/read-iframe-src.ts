import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES_ROOT } from '../paths.js';

export function readIframeSrcFromOnline(gameId: string): string | null {
	const p = join(GAMES_ROOT, gameId, 'online', 'index.html');
	if (!existsSync(p)) return null;
	const html = readFileSync(p, 'utf-8');
	const m = html.match(/<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
	if (!m?.[1]) return null;
	return m[1].trim();
}
