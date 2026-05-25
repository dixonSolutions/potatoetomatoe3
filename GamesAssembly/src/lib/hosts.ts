/** True if the playable URL is served from Y8 infrastructure (use Y8 game page as Referer). */
export function isY8PlayableHost(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return h === 'y8.com' || h === 'www.y8.com' || h.endsWith('.y8.com');
}

export function y8GameReferer(gameId: string): string {
	return `https://www.y8.com/games/${encodeURIComponent(gameId)}/`;
}

/** Poki embeds: delegate to existing download-games-offline (built-in Playwright path). */
export function isPokiGamesHost(hostname: string): boolean {
	return /^([^./]+\.)*games\.poki\.com$/i.test(hostname);
}
