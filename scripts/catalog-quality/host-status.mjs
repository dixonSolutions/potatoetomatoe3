#!/usr/bin/env node
/**
 * Derive a NSW DoE filter status for every host the catalog depends on, and write
 * scripts/data/host-filter-status.json.
 *
 * There is no public, scriptable way to ask the DoE filter about a domain: the DoE Web
 * Filter Check tool is staff-only and works only on the department network, and both
 * candidate vendors' public lookups (Palo Alto "Test A Site", FortiGuard Web Filter
 * Lookup) sit behind a CAPTCHA. So each host gets the strongest evidence available, in
 * this order, and the evidence is recorded next to the status:
 *
 *   blocked         measured on a DoE network (docs/game-launch-quality.md)
 *   likely-allowed  measured reachable on a DoE network, or a service DoE itself uses
 *   likely-blocked  same site as a measured-blocked host, or a games site (the Games
 *                   category is staff-only), or an ad/gambling host
 *   unknown         anything else — including github.io / surge.sh / small hosts that
 *                   the vendor may or may not have categorised yet
 *
 * See docs/nsw-doe-filtering.md for the research and sources.
 *
 * Usage: node scripts/catalog-quality/host-status.mjs
 */

import { join } from 'node:path';
import {
	AUDIT_DIR,
	HOST_STATUS_PATH,
	hostGroupOf,
	hostOf,
	loadCatalog,
	portalOf,
	readJson,
	readShellIframeTarget,
	writeJsonAtomic
} from './lib.mjs';

const SOURCES = {
	measured: {
		title: 'docs/game-launch-quality.md — probes and launches on a NSW DoE network, 2026-08-10',
		url: 'docs/game-launch-quality.md'
	},
	doeWebFiltering2021: {
		title:
			'NSW DoE staff "Web filtering" how-to page (last updated 09-Mar-2021), released under GIPA',
		url: 'https://www.righttoknow.org.au/request/7353/response/21020/attach/4/r%20Web%20Page%20for%20release.pdf?cookie_passthrough=1'
	},
	tnfs2013: {
		title: 'DoE Technology News for Schools (2013): uncategorised sites blocked for students',
		url: 'https://schoolsequella.det.nsw.edu.au/file/e659394c-b7b1-4f5e-8cbf-887d555538cc/1/TNFS01-11PDF.zip/TNFS03.pdf'
	},
	googleWorkspace: {
		title:
			'DoE provides Google Workspace; schools publish on sites.google.com/education.nsw.gov.au',
		url: 'https://education.nsw.gov.au/technology/products-and-services/software/googleworkspace'
	}
};

/**
 * Evidence rules, first match wins. `test` receives the collapsed host name.
 * Keep each rule's evidence to one sentence a reviewer can check.
 */
const RULES = [
	/* ---------------- measured on a DoE network ---------------- */
	...[
		'games.crazygames.com',
		'app-*.games.s3.yandex.net',
		'cdn2.addictinggames.com',
		'www.coolmathgames.com'
	].map((host) => ({
		test: (h) => h === host,
		status: 'blocked',
		evidence: 'Returned the "NSW DoE Secure Internet at Edge" 403 block page on a DoE network.',
		source: 'measured'
	})),
	{
		test: (h) => ['play.unity.com', 'cdn.play.unity.com'].includes(h),
		status: 'likely-allowed',
		evidence: 'Reachable on a DoE network; 20/20 sampled Unity Play games launched there.',
		source: 'measured'
	},
	{
		test: (h) => h === 'cdn.jsdelivr.net',
		status: 'likely-allowed',
		evidence:
			'Reachable on a DoE network; 20/20 sampled Drive U 7 games (jsDelivr content) launched there via the relay.',
		source: 'measured'
	},
	{
		test: (h) => h === 'abinbins.github.io',
		status: 'likely-allowed',
		evidence:
			'Reachable on a DoE network (measured). Other github.io sites are categorised separately.',
		source: 'measured'
	},
	{
		test: (h) => h === 'sites.google.com',
		status: 'likely-allowed',
		evidence:
			'DoE schools publish on sites.google.com and Drive U 7 pages were fetched there; a single Google Site can still be categorised on its own.',
		source: 'googleWorkspace'
	},

	/* ---------------- same site as a measured block ---------------- */
	{
		test: (h) => /(^|\.)crazygames\.com$/.test(h),
		status: 'likely-blocked',
		evidence: 'Same site as games.crazygames.com, which is blocked.',
		source: 'measured'
	},
	{
		test: (h) => /(^|\.)addictinggames\.com$/.test(h),
		status: 'likely-blocked',
		evidence: 'Same site as cdn2.addictinggames.com, which is blocked.',
		source: 'measured'
	},
	{
		test: (h) => /(^|\.)coolmathgames\.com$/.test(h),
		status: 'likely-blocked',
		evidence: 'Same site as www.coolmathgames.com, which is blocked.',
		source: 'measured'
	},
	{
		test: (h) => h === 'playhop.com' || /\.games\.s3\.yandex\.net$/.test(h),
		status: 'likely-blocked',
		evidence: 'Yandex Games / Playhop; its game hosts are blocked.',
		source: 'measured'
	},

	/* ---------------- category reasoning ---------------- */
	{
		test: (h) => /\.io$/.test(h),
		status: 'likely-blocked',
		evidence:
			'A .io browser game; most .io game domains were blocked on a DoE network and Games is a staff-only category.',
		source: 'measured'
	},
	{
		test: (h) =>
			/(^|\.)(fnf-games\.io|gamedistribution\.com|gamepix\.com|itch\.zone|itch\.io|shockwave\.com|gameskite\.com|kixeye\.com|callofwar\.com|conflictnations\.com|elvenar\.com|empireww3\.com|eternalfury\.com|dragonawaken\.com|battlestick2\.net|rebubbled\.com|foony\.com|3wayint\.com|amt-storage\.com)$/.test(
				h
			),
		status: 'likely-blocked',
		evidence:
			'A games portal or browser-game publisher; the Games category is staff-only for students.',
		source: 'doeWebFiltering2021'
	},
	{
		test: (h) => /(^|\.)(casinoworld\.com|doubleclick\.net)$/.test(h),
		status: 'likely-blocked',
		evidence: 'Gambling or ad-serving host; both categories are routinely blocked for students.',
		source: 'doeWebFiltering2021'
	}
];

const UNKNOWN_NOTE =
	'No measurement and no category evidence. The vendor lookups need a CAPTCHA; DoE blocks uncategorised sites for students, so a small or new host may well be blocked.';

function classifyHost(host) {
	for (const rule of RULES) {
		if (rule.test(host))
			return { status: rule.status, evidence: rule.evidence, source: rule.source };
	}
	return { status: 'unknown', evidence: UNKNOWN_NOTE, source: 'tnfs2013' };
}

function loadProbes() {
	const out = new Map();
	for (const portal of [
		'addictinggames',
		'coolmath',
		'crazygames',
		'drive-u-7',
		'fnf-games',
		'github',
		'local',
		'playhop',
		'unity-play'
	]) {
		const cache = readJson(join(AUDIT_DIR, `probe-${portal}.json`));
		for (const [id, record] of Object.entries(cache?.results || {})) out.set(id, record);
	}
	return out;
}

/** Every host a launch of this game touches that we know about, by role. */
export function playHostsOf(game, probe) {
	const hosts = new Map();
	const add = (url, role) => {
		const host = hostGroupOf(hostOf(url));
		if (host && !hosts.has(host)) hosts.set(host, role);
	};
	if (game.onlineEmbedUrl) add(game.onlineEmbedUrl, 'embed');
	else {
		const shell = probe?.shell?.u || readShellIframeTarget(game.id).url;
		if (shell) add(shell, 'shell-iframe');
	}
	if (probe?.f) add(probe.f, 'redirect');
	if (probe?.jr) add(probe.jr, 'redirect');
	if (probe?.inner?.u) add(probe.inner.u, 'gadget');
	if (portalOf(game) === 'unity-play') add('https://cdn.play.unity.com/', 'assets');
	return hosts;
}

function main() {
	const catalog = loadCatalog();
	const probes = loadProbes();
	const hosts = new Map();
	const thumbs = new Map();

	const bump = (map, host, game, role) => {
		let entry = map.get(host);
		if (!entry) {
			entry = { games: 0, portals: {}, roles: {} };
			map.set(host, entry);
		}
		entry.games += 1;
		const portal = portalOf(game);
		entry.portals[portal] = (entry.portals[portal] || 0) + 1;
		entry.roles[role] = (entry.roles[role] || 0) + 1;
	};

	for (const game of catalog) {
		for (const [host, role] of playHostsOf(game, probes.get(game.id)))
			bump(hosts, host, game, role);
		const thumb = game.thumbnail || '';
		if (/^https?:\/\//i.test(thumb)) bump(thumbs, hostGroupOf(hostOf(thumb)), game, 'thumbnail');
	}

	const build = (map) =>
		Object.fromEntries(
			[...map]
				.sort((a, b) => b[1].games - a[1].games || a[0].localeCompare(b[0]))
				.map(([host, entry]) => [host, { ...classifyHost(host), ...entry }])
		);

	const playHosts = build(hosts);
	const thumbnailHosts = build(thumbs);
	const tally = (table) =>
		Object.values(table).reduce((acc, entry) => {
			acc[entry.status] = (acc[entry.status] || 0) + entry.games;
			return acc;
		}, {});

	writeJsonAtomic(
		HOST_STATUS_PATH,
		{
			version: 1,
			generatedAt: new Date().toISOString(),
			method:
				'Per-host NSW DoE filter status from on-network measurements, then same-site and category reasoning. See docs/nsw-doe-filtering.md.',
			legend: {
				blocked: 'Measured blocked on a DoE network.',
				'likely-blocked': 'Same site as a measured block, or a category DoE blocks for students.',
				'likely-allowed': 'Measured reachable on a DoE network, or a service DoE itself uses.',
				unknown: 'No evidence either way.'
			},
			sources: SOURCES,
			gameCountsByStatus: tally(playHosts),
			hosts: playHosts,
			thumbnailHosts
		},
		{ pretty: true }
	);
	console.log(
		`host status: ${Object.keys(playHosts).length} play hosts, ${Object.keys(thumbnailHosts).length} thumbnail hosts`
	);
	console.log('game-host links by status:', tally(playHosts));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
