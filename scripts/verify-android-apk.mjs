#!/usr/bin/env node
/**
 * Guard against publishing an APK Android cannot install.
 *
 * Release 0.0.72 shipped `app-universal-release-unsigned.apk` as
 * `potato-tomato-0.0.72.apk`. Android rejects unsigned packages outright
 * (INSTALL_PARSE_FAILED_NO_CERTIFICATES), so the app never launched — the build
 * was green the whole time because nothing checked the signature.
 *
 * Usage:
 *   node scripts/verify-android-apk.mjs [path/to.apk]
 *
 * With no argument, verifies the newest release APK under the Gradle output tree.
 * Needs apksigner from the Android SDK build-tools ($ANDROID_HOME / $ANDROID_SDK_ROOT).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const APK_OUT = path.join(ROOT, 'src-tauri/gen/android/app/build/outputs/apk');

function fail(message) {
	console.error(`[verify-android-apk] ${message}`);
	process.exit(1);
}

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(p, out);
		else if (entry.name.endsWith('.apk')) out.push(p);
	}
	return out;
}

function findApksigner() {
	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
	if (!sdk) return null;
	const buildTools = path.join(sdk, 'build-tools');
	if (!fs.existsSync(buildTools)) return null;
	/* Highest build-tools version wins — apksigner is backwards compatible. */
	const versions = fs
		.readdirSync(buildTools)
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	for (const version of versions.reverse()) {
		const candidate = path.join(buildTools, version, 'apksigner');
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function resolveApk() {
	const explicit = process.argv[2];
	if (explicit) {
		if (!fs.existsSync(explicit)) fail(`APK not found: ${explicit}`);
		return explicit;
	}
	const candidates = walk(APK_OUT).filter((p) => p.includes('release'));
	if (!candidates.length) {
		fail(`no release APK under ${path.relative(ROOT, APK_OUT)} — run pnpm android:build first`);
	}
	return candidates.sort(
		(a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
	)[0];
}

const apk = resolveApk();
const rel = path.relative(ROOT, apk);

if (path.basename(apk).includes('unsigned')) {
	fail(
		`${rel} is unsigned — Android will refuse to install it.\n` +
			'  Create src-tauri/gen/android/key.properties (storeFile/storePassword/keyAlias/keyPassword).\n' +
			'  See docs/release.md → Android signing.'
	);
}

const apksigner = findApksigner();
if (!apksigner) {
	fail('apksigner not found — set ANDROID_HOME to an SDK with build-tools installed');
}

let output;
try {
	output = execFileSync(apksigner, ['verify', '--print-certs', apk], { encoding: 'utf-8' });
} catch (err) {
	fail(`${rel} failed signature verification:\n${err.stdout || ''}${err.stderr || err.message}`);
}

const signer = output.match(/Signer #1 certificate DN:.*/)?.[0] ?? '(certificate DN not reported)';
const sizeMb = (fs.statSync(apk).size / 1024 / 1024).toFixed(0);
console.log(`[verify-android-apk] ${rel} (${sizeMb} MB) is signed`);
console.log(`[verify-android-apk] ${signer.trim()}`);

if (/CN=Android Debug/i.test(output)) {
	fail(
		'signed with the Android debug key — installable for testing, but must not be published.\n' +
			'  Debug keys differ per machine, so users cannot upgrade between releases.'
	);
}
