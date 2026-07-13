import { injectUnityPatches, isUnityGameHtml } from '../unity/inject-html.js';
import { injectGameStorageBridge } from '../game-storage-bridge-script.js';
import { WGET_USER_AGENT } from '../config.js';
import { assertSafePlayUrl } from './safety.js';
import {
	allowOrigin,
	createLiveSession,
	getLiveSession,
	isOriginAllowed,
	resolveSessionAssetUrl,
	type LiveSession
} from './session.js';
import { normalizeBaseUrl, resolveLiveTargetUrl } from './target.js';

const FETCH_TIMEOUT_MS = 60_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 80 * 1024 * 1024;

export interface LiveHtmlResult {
	session: LiveSession;
	html: string;
	contentType: string;
}

function looksLikeUnity(metaEngine: unknown, html: string): boolean {
	if (typeof metaEngine === 'string' && metaEngine.toLowerCase() === 'unity') return true;
	return isUnityGameHtml(html);
}

/**
 * Rewrite relative src/href and CSS url() to the live session proxy path.
 * Absolute same-origin URLs are also rewritten so nested assets stay on the relay.
 * Cross-origin absolute URLs stay absolute but their origin is allowlisted for ?u= fetches.
 */
export function rewriteHtmlForLiveSession(
	html: string,
	session: LiveSession,
	proxyPrefix: string
): string {
	const base = new URL(session.baseHref);

	const toProxy = (rawUrl: string): string => {
		try {
			const abs = new URL(rawUrl, base);
			assertSafePlayUrl(abs.href);
			allowOrigin(session, abs.origin);
			if (abs.origin === session.targetOrigin) {
				const rel = abs.pathname.replace(/^\//, '') + abs.search + abs.hash;
				return `${proxyPrefix}/${rel}`;
			}
			/* Cross-origin CDN: keep absolute URL so browser fetches it directly when CORS allows.
			 * Also expose a proxied form via ?u= for cases that need same-origin. */
			const encoded = encodeURIComponent(abs.href);
			return `${proxyPrefix}/_ext?u=${encoded}`;
		} catch {
			return rawUrl;
		}
	};

	let out = html.replace(
		/(src|href)=["'](?!data:|blob:|#|javascript:)([^"']+)["']/gi,
		(_m, attr: string, rel: string) => `${attr}="${toProxy(rel)}"`
	);

	out = out.replace(/url\(\s*(['"]?)(?!data:|blob:)([^)'"]+)\1\s*\)/gi, (_m, _q, rel: string) => {
		return `url("${toProxy(rel.trim())}")`;
	});

	return out;
}

export async function startLiveGameHtml(
	gameId: string,
	metaEngine: unknown,
	proxyPrefixForGame: (sessionId: string) => string
): Promise<LiveHtmlResult | null> {
	const targetUrl = await resolveLiveTargetUrl(gameId);
	if (!targetUrl) return null;

	const session = createLiveSession({
		gameId,
		targetUrl: normalizeBaseUrl(targetUrl)
	});
	/* Entry may be a file URL — keep exact target for first fetch. */
	session.targetUrl = targetUrl;
	session.baseHref = targetUrl;

	const res = await fetch(targetUrl, {
		headers: {
			'User-Agent': WGET_USER_AGENT,
			Accept: 'text/html,application/xhtml+xml,*/*'
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		redirect: 'follow'
	});
	if (!res.ok) return null;

	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_HTML_BYTES) {
		throw new Error('Live HTML response too large');
	}

	let html = buf.toString('utf-8');
	if (looksLikeUnity(metaEngine, html)) {
		html = injectUnityPatches(html);
	}

	const proxyPrefix = proxyPrefixForGame(session.id);
	html = rewriteHtmlForLiveSession(html, session, proxyPrefix);
	html = injectGameStorageBridge(html, gameId);

	const contentType = res.headers.get('content-type') || 'text/html; charset=utf-8';
	return { session, html, contentType };
}

export interface ProxiedAsset {
	status: number;
	contentType: string;
	body: Buffer;
	cacheControl?: string;
}

export async function fetchLiveAsset(
	gameId: string,
	sessionId: string,
	assetPath: string,
	absoluteOverride?: string | null
): Promise<ProxiedAsset | null> {
	const session = getLiveSession(gameId, sessionId);
	if (!session) return null;

	const remoteUrl = resolveSessionAssetUrl(session, assetPath, absoluteOverride);
	const parsed = assertSafePlayUrl(remoteUrl);
	if (!isOriginAllowed(session, parsed.origin)) {
		/* First-party relative rewrites already allowlisted; reject surprise origins. */
		throw new Error('Asset origin not allowed for this live session');
	}

	const res = await fetch(remoteUrl, {
		headers: {
			'User-Agent': WGET_USER_AGENT,
			Accept: '*/*',
			Referer: session.targetUrl
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		redirect: 'follow'
	});

	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_ASSET_BYTES) {
		throw new Error('Live asset response too large');
	}

	let contentType = res.headers.get('content-type') || 'application/octet-stream';
	let body = buf;

	/* Nested HTML (iframes): inject bridge + rewrite against this session. */
	if (/text\/html/i.test(contentType) || /\.html?$/i.test(parsed.pathname)) {
		let html = buf.toString('utf-8');
		const proxyPrefix = `/api/game-live/${encodeURIComponent(gameId)}/${session.id}`;
		if (isUnityGameHtml(html)) {
			html = injectUnityPatches(html);
		}
		html = rewriteHtmlForLiveSession(html, session, proxyPrefix);
		html = injectGameStorageBridge(html, gameId);
		body = Buffer.from(html, 'utf-8');
		contentType = 'text/html; charset=utf-8';
	}

	return {
		status: res.status,
		contentType,
		body,
		cacheControl: res.headers.get('cache-control') || undefined
	};
}

/** Convenience: unity-play compatibility without creating a multi-asset session. */
export async function fetchSimpleProxiedPlayHtml(
	gameId: string,
	metaEngine: unknown
): Promise<string | null> {
	const targetUrl = await resolveLiveTargetUrl(gameId);
	if (!targetUrl) return null;

	const res = await fetch(targetUrl, {
		headers: {
			'User-Agent': WGET_USER_AGENT,
			Accept: 'text/html,application/xhtml+xml,*/*'
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!res.ok) return null;

	let html = await res.text();
	if (looksLikeUnity(metaEngine, html)) {
		html = injectUnityPatches(html);
	}

	const base = new URL(targetUrl);
	html = html.replace(
		/(src|href)=["'](?!https?:|\/\/|data:|blob:|#)([^"']+)["']/gi,
		(_m, attr, rel) => `${attr}="${new URL(rel, base).href}"`
	);

	return injectGameStorageBridge(html, gameId);
}
