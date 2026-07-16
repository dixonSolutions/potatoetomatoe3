import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	createJob,
	getProgressJobForGame,
	listRecentJobs,
	updateJob
} from './jobs.js';

describe('puller job lifecycle serialization', () => {
	it('exposes terminal job fields for harness progress polling', () => {
		const job = createJob('harness-test-game');
		assert.equal(job.state, 'pending');
		updateJob('harness-test-game', {
			state: 'running',
			progress: 42,
			message: 'Capturing…'
		});
		updateJob('harness-test-game', {
			state: 'done',
			progress: 100,
			message: 'Complete',
			finishedAt: Date.now()
		});
		const progress = getProgressJobForGame('harness-test-game');
		assert.ok(progress);
		assert.equal(progress.state, 'done');
		assert.equal(progress.progress, 100);
		assert.equal(progress.gameId, 'harness-test-game');
		const recent = listRecentJobs();
		assert.ok(recent.some((entry) => entry.gameId === 'harness-test-game' && entry.state === 'done'));
	});
});
