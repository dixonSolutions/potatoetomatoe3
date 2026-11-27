/**
 * Overlap-free placement for the touch controls.
 *
 * Controls come from saved layouts, defaults sized for another screen, per-game extras
 * and the global scale, so they can land on top of each other. `resolveOverlaps` moves
 * them apart: each pass pushes every overlapping pair apart along the axis that needs the
 * smaller move, then clamps everything back inside the bounds. Pinned rects (the one the
 * player is dragging) never move. Deterministic: same input, same output.
 */

export type Rect = { id: string; x: number; y: number; w: number; h: number; pinned?: boolean };
export type Bounds = { x: number; y: number; w: number; h: number };

/** Gap kept between controls, in px. */
export const CONTROL_GAP = 6;

function overlapX(a: Rect, b: Rect, gap: number) {
	return Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x);
}

function overlapY(a: Rect, b: Rect, gap: number) {
	return Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y);
}

/** Do two rects overlap (closer than `gap`)? */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
	return overlapX(a, b, gap) > 0.5 && overlapY(a, b, gap) > 0.5;
}

/** Pairs of ids that overlap. */
export function overlappingPairs(rects: Rect[], gap = 0): [string, string][] {
	const out: [string, string][] = [];
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			if (rectsOverlap(rects[i], rects[j], gap)) out.push([rects[i].id, rects[j].id]);
		}
	}
	return out;
}

function clamp(r: Rect, b: Bounds) {
	r.x = Math.min(Math.max(r.x, b.x), b.x + Math.max(0, b.w - r.w));
	r.y = Math.min(Math.max(r.y, b.y), b.y + Math.max(0, b.h - r.h));
}

/**
 * Move rects apart until none overlap (or `maxPasses` runs out, e.g. when they cannot
 * all fit). Returns new rects; the input is not changed.
 */
export function resolveOverlaps(
	input: Rect[],
	bounds: Bounds,
	{ gap = CONTROL_GAP, maxPasses = 60 }: { gap?: number; maxPasses?: number } = {}
): Rect[] {
	const rects = input.map((r) => ({ ...r }));
	for (const r of rects) if (!r.pinned) clamp(r, bounds);
	for (let pass = 0; pass < maxPasses; pass++) {
		let moved = false;
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				const a = rects[i];
				const b = rects[j];
				if (a.pinned && b.pinned) continue;
				const ox = overlapX(a, b, gap);
				const oy = overlapY(a, b, gap);
				if (ox <= 0.5 || oy <= 0.5) continue;
				moved = true;
				/* Share the move, or give it all to the free one when the other is pinned. */
				const shareA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
				const shareB = 1 - shareA;
				/*
				 * Smaller move first; in the second half alternate axes, so a pair pinned
				 * against a wall on one axis gets out along the other.
				 */
				const useX = pass < maxPasses / 2 ? ox < oy : (pass + i + j) % 2 === 0;
				if (useX) {
					const dir = a.x + a.w / 2 <= b.x + b.w / 2 ? -1 : 1;
					a.x += dir * ox * shareA;
					b.x -= dir * ox * shareB;
				} else {
					const dir = a.y + a.h / 2 <= b.y + b.h / 2 ? -1 : 1;
					a.y += dir * oy * shareA;
					b.y -= dir * oy * shareB;
				}
				if (!a.pinned) clamp(a, bounds);
				if (!b.pinned) clamp(b, bounds);
			}
		}
		if (!moved) break;
	}
	return rects;
}
