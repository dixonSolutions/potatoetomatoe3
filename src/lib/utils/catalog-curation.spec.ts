import { describe, expect, it } from 'vitest';
import {
	curateCatalog,
	hardReason,
	isDistinctiveTitle,
	resolveAlias,
	toCurationFile
} from '../../../scripts/lib/catalog-curation.mjs';
import { followAlias } from './catalog-aliases';

type Q = { tier: string; q?: number; why?: string[] };
const games = [
	{ id: 'cg-dino-run', name: 'Dino Run Deluxe 🕹️ Play on CrazyGames', sourcePortal: 'crazygames' },
	{
		id: 'cm-dino-run',
		name: 'Dino Run Deluxe - Play it Online at Coolmath Games',
		sourcePortal: 'coolmath'
	},
	{ id: 'ag-dino-run', name: 'Dino Run Deluxe', sourcePortal: 'addictinggames' },
	{ id: 'cg-only', name: 'Castle Defender Saga', sourcePortal: 'crazygames' },
	{ id: 'copy-2048', name: '2048 remix', sourcePortal: 'unity-play' },
	{ id: 'orig-2048', name: '2048', sourcePortal: 'coolmath' },
	{ id: 'ag-space', name: 'Space', sourcePortal: 'addictinggames' },
	{ id: 'up-space', name: 'Space', sourcePortal: 'unity-play' },
	{ id: 'forbidden', name: 'Bot Blocked Game', sourcePortal: 'local' },
	{ id: 'tutorial', name: 'Roll a Ball Tutorial', sourcePortal: 'unity-play' },
	{ id: 'template', name: 'My Microgame', sourcePortal: 'unity-play' },
	{ id: 'good', name: 'Good Game', sourcePortal: 'poki' }
];
const quality: Record<string, Q> = {
	'cg-dino-run': { tier: 'broken', q: 3, why: ['portal-exclusive'] },
	'cm-dino-run': { tier: 'good', q: 70, why: [] },
	'ag-dino-run': { tier: 'good', q: 70, why: [] },
	'cg-only': { tier: 'broken', q: 2, why: ['portal-exclusive'] },
	'copy-2048': { tier: 'broken', q: 1, why: ['copy-of:orig-2048'] },
	'orig-2048': { tier: 'featured', q: 90, why: [] },
	'ag-space': { tier: 'broken', q: 4, why: ['http-404'] },
	'up-space': { tier: 'ok', q: 50, why: [] },
	forbidden: { tier: 'broken', q: 5, why: ['http-403', 'no-thumbnail'] },
	tutorial: { tier: 'test', q: 12, why: ['tutorial'] },
	template: { tier: 'test', q: 11, why: ['microgame-template'] },
	good: { tier: 'good', q: 75, why: [] }
};

describe('catalog curation', () => {
	const plan = curateCatalog(games, quality, { maxRemoveShare: 1 });
	const fate = (id: string) =>
		plan.replace.find((r) => r.id === id)?.by ??
		(plan.remove.some((r) => r.id === id) ? 'removed' : 'kept');

	it('replaces a portal-only copy with the most official working copy', () => {
		expect(fate('cg-dino-run')).toBe('cm-dino-run');
	});
	it('a copy is replaced by the original it points at', () => {
		expect(fate('copy-2048')).toBe('orig-2048');
	});
	it('removes a broken game with no working copy', () => {
		expect(fate('cg-only')).toBe('removed');
		expect(fate('template')).toBe('removed');
	});
	it('a short generic title never matches another game', () => {
		expect(fate('ag-space')).toBe('removed');
		expect(isDistinctiveTitle('space')).toBe(false);
		expect(isDistinctiveTitle('3d free kick')).toBe(true);
		expect(isDistinctiveTitle('voxiom io')).toBe(true);
		expect(isDistinctiveTitle('2048')).toBe(true);
	});
	it('soft signals only hide: 403, no thumbnail, tutorials are kept', () => {
		expect(fate('forbidden')).toBe('kept');
		expect(fate('tutorial')).toBe('kept');
		expect(hardReason(quality.forbidden)).toBeNull();
	});
	it('good games and keep-ids are never touched', () => {
		expect(fate('good')).toBe('kept');
		const kept = curateCatalog(games, quality, {
			keepIds: new Set(['cg-only']),
			maxRemoveShare: 1
		});
		expect(kept.remove.some((r: { id: string }) => r.id === 'cg-only')).toBe(false);
	});
	it('refuses a plan that would drop too much of the catalog', () => {
		expect(curateCatalog(games, quality, { maxRemoveShare: 0.2 }).aborted).toMatch(/would drop/);
		expect(plan.aborted).toBeUndefined();
	});
	it('the curation file lists removed + replaced ids and aliases that resolve', () => {
		const file = toCurationFile(plan, 'now');
		expect(Object.keys(file.removed).sort()).toEqual(
			[...plan.remove, ...plan.replace].map((r: { id: string }) => r.id).sort()
		);
		expect(file.aliases['copy-2048']).toBe('orig-2048');
		expect(resolveAlias({ a: 'b', b: 'c' }, 'a')).toBe('c');
		expect(followAlias({ a: 'b', b: 'c' }, 'a')).toBe('c');
		expect(followAlias({ a: 'b' }, 'x')).toBeNull();
		expect(followAlias({ a: 'b', b: 'a' }, 'a')).not.toBeUndefined();
	});
});
