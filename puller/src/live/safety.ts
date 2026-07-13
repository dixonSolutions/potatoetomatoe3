import net from 'node:net';

const PRIVATE_IPV4 = [
	/^127\./,
	/^10\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\./,
	/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT
	/^172\.(1[6-9]|2\d|3[0-1])\./
];

/** True when hostname is localhost, private, or link-local (SSRF risk). */
export function isBlockedHostname(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
	if (!host) return true;
	if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
	if (host === '0.0.0.0' || host === '::') return true;

	const ipVersion = net.isIP(host);
	if (ipVersion === 4) {
		return PRIVATE_IPV4.some((re) => re.test(host));
	}
	if (ipVersion === 6) {
		const normalized = host.toLowerCase();
		return (
			normalized === '::1' ||
			normalized.startsWith('fc') ||
			normalized.startsWith('fd') ||
			normalized.startsWith('fe80:')
		);
	}
	return false;
}

/** Validate a catalog play target before upstream fetch. */
export function assertSafePlayUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid play target URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Play target must be http(s)');
	}
	if (isBlockedHostname(url.hostname)) {
		throw new Error('Play target host is not allowed');
	}
	return url;
}
