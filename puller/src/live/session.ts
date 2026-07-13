import { randomBytes } from 'node:crypto';

export interface LiveSession {
	id: string;
	gameId: string;
	/** Absolute URL of the remote entry document. */
	targetUrl: string;
	/** Origin used for same-origin asset checks. */
	targetOrigin: string;
	/** Pathname directory of the entry (for resolving relative assets). */
	baseHref: string;
	createdAt: number;
	lastUsedAt: number;
	/** Extra remote origins allowed for this session (CDNs discovered in HTML). */
	allowedOrigins: Set<string>;
}

const sessions = new Map<string, LiveSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 64;

function newSessionId(): string {
	return randomBytes(12).toString('hex');
}

function expireIdle(): void {
	const now = Date.now();
	for (const [id, session] of sessions) {
		if (now - session.lastUsedAt > SESSION_TTL_MS) {
			sessions.delete(id);
		}
	}
	while (sessions.size > MAX_SESSIONS) {
		let oldestId: string | null = null;
		let oldestAt = Number.POSITIVE_INFINITY;
		for (const [id, session] of sessions) {
			if (session.lastUsedAt < oldestAt) {
				oldestAt = session.lastUsedAt;
				oldestId = id;
			}
		}
		if (!oldestId) break;
		sessions.delete(oldestId);
	}
}

export function createLiveSession(options: {
	gameId: string;
	targetUrl: string;
}): LiveSession {
	expireIdle();
	const target = new URL(options.targetUrl);
	const baseHref = options.targetUrl;
	const session: LiveSession = {
		id: newSessionId(),
		gameId: options.gameId,
		targetUrl: options.targetUrl,
		targetOrigin: target.origin,
		baseHref,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
		allowedOrigins: new Set([target.origin])
	};
	sessions.set(session.id, session);
	return session;
}

export function getLiveSession(gameId: string, sessionId: string): LiveSession | null {
	expireIdle();
	const session = sessions.get(sessionId);
	if (!session || session.gameId !== gameId) return null;
	session.lastUsedAt = Date.now();
	return session;
}

export function allowOrigin(session: LiveSession, origin: string): void {
	session.allowedOrigins.add(origin);
}

export function isOriginAllowed(session: LiveSession, origin: string): boolean {
	return session.allowedOrigins.has(origin);
}

/** Resolve a proxied path segment (and optional ?u= absolute override) to a remote URL. */
export function resolveSessionAssetUrl(
	session: LiveSession,
	assetPath: string,
	absoluteOverride?: string | null
): string {
	if (absoluteOverride) {
		const abs = new URL(absoluteOverride);
		if (!isOriginAllowed(session, abs.origin)) {
			throw new Error('Asset origin not allowed for this live session');
		}
		return abs.href;
	}
	const rel = assetPath.replace(/^\/+/, '');
	/* Proxy paths are origin-root pathnames from rewriteHtmlForLiveSession. */
	return new URL(`/${rel || ''}`, session.targetOrigin).href;
}

export function liveSessionCount(): number {
	expireIdle();
	return sessions.size;
}
