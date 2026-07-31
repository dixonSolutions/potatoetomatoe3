import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
	isGzipMagic,
	patchUnityFrameworkSource,
	safeUnityDecompress
} from './framework-patches.js';

const injectPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/unity/inject.js'
);

describe('unity/framework-patches stdin asserts', () => {
	it('patches literal-left assert(0===stdin.fd,…)', () => {
		const src =
			'assert(0===stdin.fd,"invalid handle for stdin ("+stdin.fd+")");' +
			'assert(1===stdout.fd,"invalid handle for stdout ("+stdout.fd+")");' +
			'assert(2===stderr.fd,"invalid handle for stderr ("+stderr.fd+")");';
		const out = patchUnityFrameworkSource(src);
		assert.match(out, /stdin\.fd !== 0/);
		assert.match(out, /stdout\.fd !== 1/);
		assert.match(out, /stderr\.fd !== 2/);
		assert.equal(out.includes('assert('), false);
	});

	it('patches stream-left assert(stdin.fd===0,…) used by Snow Rider / Color Tunnel', () => {
		const src =
			'assert(stdin.fd===0,"invalid handle for stdin ("+stdin.fd+")");' +
			'assert(stdout.fd===1,"invalid handle for stdout ("+stdout.fd+")");' +
			'assert(stderr.fd===2,"invalid handle for stderr ("+stderr.fd+")");';
		const out = patchUnityFrameworkSource(src);
		assert.match(out, /stdin\.fd !== 0/);
		assert.match(out, /stdout\.fd !== 1/);
		assert.match(out, /stderr\.fd !== 2/);
		assert.equal(out.includes('assert('), false);
	});

	it('leaves unrelated source unchanged', () => {
		const src = 'var x = 1; assert(true);';
		assert.equal(patchUnityFrameworkSource(src), src);
	});

	it('inject.js includes both assert comparison orders', () => {
		const inject = readFileSync(injectPath, 'utf8');
		assert.match(inject, /\(\[0-2\]\)===/);
		assert.match(inject, /\.fd===\(\[0-2\]\)/);
	});

	it('inject.js patches UnityLoader.loadCode as (job, code, callback, options)', () => {
		const inject = readFileSync(injectPath, 'utf8');
		assert.match(inject, /patchedLoadCode = function \(job, code, callback, options\)/);
		assert.match(inject, /options \|\| \{ isModularized: false \}/);
		assert.match(inject, /patchUnityFrameworkSource\(code\)/);
		assert.doesNotMatch(
			inject,
			/patchedLoadCode = function \(source, callback, options\)/
		);
	});

	it('inject.js stubs CrazySDK for unwrapped CrazyGames Unity builds', () => {
		const inject = readFileSync(injectPath, 'utf8');
		assert.match(inject, /window\.CrazySDK\s*=/);
		assert.match(inject, /InitCallback/);
		assert.match(inject, /requestAd/);
	});
});

describe('unity/framework-patches safe decompress', () => {
	it('detects gzip magic', () => {
		assert.equal(isGzipMagic(new Uint8Array([0x1f, 0x8b, 0x08])), true);
		assert.equal(isGzipMagic(new Uint8Array([0x55, 0x6e, 0x69, 0x74])), false); // UnityFS
	});

	it('passes through non-gzip UnityFS without calling inflate', () => {
		const unityFs = new Uint8Array([0x55, 0x6e, 0x69, 0x74, 0x79, 0x46, 0x53]); // UnityFS
		let called = false;
		const out = safeUnityDecompress(unityFs, () => {
			called = true;
			return new Uint8Array([1]);
		});
		assert.equal(called, false);
		assert.equal(out, unityFs);
	});

	it('gunzips when magic is gzip', () => {
		const gzipped = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
		const inflated = new Uint8Array([9, 9, 9]);
		const out = safeUnityDecompress(gzipped, (input) => {
			assert.equal(input, gzipped);
			return inflated;
		});
		assert.equal(out, inflated);
	});
});
