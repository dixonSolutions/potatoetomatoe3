import {
	PULL_EXTERNAL_SOURCES_SCRIPT,
	PULL_OFFLINE_ORCHESTRATOR_SCRIPT,
	Y8_IMPORT_SCRIPT
} from '../paths.js';

/**
 * Site-specific “pull” entrypoints: discovery + online shells live under `static/games/`.
 * Add a row when you introduce a new importer; the CLI forwards argv to the script.
 */
export type PullSiteDefinition = {
	id: string;
	label: string;
	description: string;
	/** Absolute path to a Node script under the repo (spawned with forwarded args). */
	scriptPath: string;
};

export const PULL_SITES: PullSiteDefinition[] = [
	{
		id: 'y8',
		label: 'Y8.com',
		description:
			'Import game pages from y8.com (online shell + metadata). Forward args: URL(s), --all, --limit, etc.',
		scriptPath: Y8_IMPORT_SCRIPT
	},
	{
		id: 'external',
		label: 'External portals',
		description:
			'Discover from play-games, Poki catalog, sitemaps, etc.; optional --offline mirror pipeline.',
		scriptPath: PULL_EXTERNAL_SOURCES_SCRIPT
	},
	{
		id: 'offline',
		label: 'Offline bundles only',
		description:
			'Orchestrates download-games-offline + Unity/Poki repairs + generate-games-list (no discovery).',
		scriptPath: PULL_OFFLINE_ORCHESTRATOR_SCRIPT
	}
];

export function getPullSiteById(id: string): PullSiteDefinition | undefined {
	const n = id.trim().toLowerCase();
	return PULL_SITES.find((s) => s.id === n);
}

export function formatPullSiteList(): string {
	const lines = ['Pull sites (use: pnpm run pull -- <id> [...args] or PULL_SITE=id):', ''];
	for (const s of PULL_SITES) {
		lines.push(`  ${s.id.padEnd(12)} ${s.label}`);
		lines.push(`             ${s.description}`);
		lines.push('');
	}
	return lines.join('\n');
}
