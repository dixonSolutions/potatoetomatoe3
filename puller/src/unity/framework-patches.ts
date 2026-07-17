/**
 * Pure helpers mirrored by static/unity/inject.js for WebKit / legacy UnityLoader.
 * Keep regexes and decompress logic in sync with inject.js.
 */

/** Repair FS.streams when WebKit leaves stdin/stdout/stderr on the wrong fd. */
export function repairStdioAssert(stream: string, expected: string): string {
	return (
		'if (' +
		stream +
		'.fd !== ' +
		expected +
		') { FS.streams[' +
		stream +
		'.fd] = null; ' +
		stream +
		'.fd = ' +
		expected +
		'; FS.streams[' +
		expected +
		'] = ' +
		stream +
		'; }'
	);
}

/** `assert(0===stdin.fd,"invalid handle for stdin ("+stdin.fd+")");` */
const ASSERT_LITERAL_LEFT =
	/assert\(\s*([0-2])===([A-Za-z_$][\w$]*)\.fd\s*,\s*["']invalid handle for (stdin|stdout|stderr) \(["']\+\2\.fd\+["']\)["']\s*\);/g;

/** `assert(stdin.fd===0,"invalid handle for stdin ("+stdin.fd+")");` (Snow Rider / Color Tunnel) */
const ASSERT_STREAM_LEFT =
	/assert\(\s*([A-Za-z_$][\w$]*)\.fd===([0-2])\s*,\s*["']invalid handle for (stdin|stdout|stderr) \(["']\+\1\.fd\+["']\)["']\s*\);/g;

/**
 * Patch decompressed Unity framework source so createStandardStreams does not abort
 * on WebKitGTK fd mismatches.
 */
export function patchUnityFrameworkSource(source: string): string {
	if (typeof source !== 'string' || !source.includes('invalid handle for stdin')) {
		return source;
	}

	let patched = source.replace(ASSERT_LITERAL_LEFT, (_match, expected: string, stream: string) =>
		repairStdioAssert(stream, expected)
	);
	patched = patched.replace(ASSERT_STREAM_LEFT, (_match, stream: string, expected: string) =>
		repairStdioAssert(stream, expected)
	);
	return patched;
}

/** Gzip magic number (RFC 1952). */
export function isGzipMagic(data: Uint8Array | ArrayLike<number>): boolean {
	return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Only gunzip when the payload is actually gzip. Plain UnityFS / already-decoded
 * bodies must pass through — legacy UnityLoader's *.gz fallback otherwise throws
 * "incorrect header check".
 */
export function safeUnityDecompress(
	data: Uint8Array,
	inflate: (input: Uint8Array) => Uint8Array
): Uint8Array {
	if (!isGzipMagic(data)) return data;
	return inflate(data);
}
