import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('puller browser-data disk I/O', () => {
	let tmpRoot: string;
	const gameId = 'test-game-storage';

	beforeEach(async () => {
		vi.resetModules();
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pt-browser-data-'));
		process.env.GAMES_DATA_DIR = tmpRoot;
		await fs.mkdir(path.join(tmpRoot, gameId), { recursive: true });
	});

	afterEach(async () => {
		delete process.env.GAMES_DATA_DIR;
		vi.resetModules();
		await fs.rm(tmpRoot, { recursive: true, force: true });
	});

	it('writes and reads profile under data/', async () => {
		const { readGameBrowserProfile, writeGameBrowserProfile } = await import(
			'../../../puller/src/browser-data.js'
		);
		const { emptyGameBrowserProfile } = await import(
			'../../../puller/src/browser-data-profile.js'
		);

		const profile = emptyGameBrowserProfile();
		profile.profile.Default.localStorage['http://localhost'] = { score: '42' };
		profile.profile.Default.indexedDB.push({
			name: 'game-db',
			version: 1,
			objectStores: ['s1'],
			records: [{ storeName: 's1', key: '"id"', value: '"x"' }]
		});

		await writeGameBrowserProfile(gameId, profile);
		const loaded = await readGameBrowserProfile(gameId);

		expect(loaded).not.toBeNull();
		expect(loaded!.profile.Default.localStorage['http://localhost']).toEqual({ score: '42' });
		expect(loaded!.profile.Default.indexedDB[0].records).toHaveLength(1);

		const metaPath = path.join(tmpRoot, gameId, 'data', 'meta.json');
		const metaRaw = await fs.readFile(metaPath, 'utf-8');
		expect(JSON.parse(metaRaw).updatedAt).toBeGreaterThan(0);
	});

	it('delete removes data tree', async () => {
		const { readGameBrowserProfile, writeGameBrowserProfile, deleteGameBrowserProfile } =
			await import('../../../puller/src/browser-data.js');
		const { emptyGameBrowserProfile } = await import(
			'../../../puller/src/browser-data-profile.js'
		);

		const profile = emptyGameBrowserProfile();
		await writeGameBrowserProfile(gameId, profile);
		const dataDir = path.join(tmpRoot, gameId, 'data');
		expect(await fs.stat(dataDir)).toBeDefined();

		await deleteGameBrowserProfile(gameId);
		await expect(fs.stat(dataDir)).rejects.toThrow();
		expect(await readGameBrowserProfile(gameId)).toBeNull();
	});
});
