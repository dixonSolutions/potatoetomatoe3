import { describe, expect, it } from 'vitest';
import { getDefaultTouchLayout, type TouchLayout } from './touch-console';
import { CONTROL_GAP, overlappingPairs, resolveOverlaps, type Rect } from './touch-layout-solver';

/** The rects TouchConsole draws for a layout (space bar is 2.1× wide). */
function layoutRects(layout: TouchLayout, w: number, h: number, scale: number): Rect[] {
	const js = Math.round(layout.joystick.size * scale);
	return [
		{ id: 'joystick', x: layout.joystick.xPct * w, y: layout.joystick.yPct * h, w: js, h: js },
		...layout.buttons.map((b) => {
			const size = Math.round(b.size * scale);
			return {
				id: b.id,
				x: b.xPct * w,
				y: b.yPct * h,
				w: b.id === 'space' ? Math.round(b.size * 2.1 * scale) : size,
				h: size
			};
		})
	];
}

const inside = (r: Rect, w: number, h: number) =>
	r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= w + 0.01 && r.y + r.h <= h + 0.01;

describe('resolveOverlaps', () => {
	it('separates a pile of controls dropped on one spot', () => {
		const pile: Rect[] = Array.from({ length: 6 }, (_, i) => ({
			id: `b${i}`,
			x: 300,
			y: 150,
			w: 56,
			h: 56
		}));
		const out = resolveOverlaps(pile, { x: 0, y: 0, w: 844, h: 390 });
		expect(overlappingPairs(out)).toEqual([]);
		expect(out.every((r) => inside(r, 844, 390))).toBe(true);
	});

	it('never moves a pinned control (the one being dragged)', () => {
		const rects: Rect[] = [
			{ id: 'drag', x: 100, y: 100, w: 60, h: 60, pinned: true },
			{ id: 'a', x: 110, y: 110, w: 60, h: 60 },
			{ id: 'b', x: 90, y: 120, w: 60, h: 60 }
		];
		const out = resolveOverlaps(rects, { x: 0, y: 0, w: 600, h: 400 });
		expect(out[0]).toMatchObject({ x: 100, y: 100 });
		expect(overlappingPairs(out)).toEqual([]);
	});

	it('gets a pair out of a corner along the other axis', () => {
		const rects: Rect[] = [
			{ id: 'a', x: 0, y: 0, w: 80, h: 80 },
			{ id: 'b', x: 0, y: 10, w: 80, h: 80 }
		];
		const out = resolveOverlaps(rects, { x: 0, y: 0, w: 300, h: 300 });
		expect(overlappingPairs(out)).toEqual([]);
	});

	it('keeps an already clean layout where it is', () => {
		const rects: Rect[] = [
			{ id: 'a', x: 10, y: 10, w: 50, h: 50 },
			{ id: 'b', x: 200, y: 10, w: 50, h: 50 }
		];
		expect(resolveOverlaps(rects, { x: 0, y: 0, w: 400, h: 200 })).toEqual(rects);
	});

	/* The overlap test the A12 evidence asks for: defaults on real screen sizes, all scales. */
	const SCREENS = [
		{ name: 'phone landscape', w: 844, h: 390, o: 'landscape' as const },
		{ name: 'small phone landscape', w: 568, h: 320, o: 'landscape' as const },
		{ name: 'tablet landscape', w: 1180, h: 820, o: 'landscape' as const },
		{ name: 'phone portrait', w: 390, h: 844, o: 'portrait' as const },
		{ name: 'small phone portrait', w: 320, h: 568, o: 'portrait' as const }
	];
	for (const s of SCREENS) {
		for (const scale of [0.8, 1, 1.25, 1.5]) {
			it(`default ${s.o} layout on ${s.name} at scale ${scale}: 0 overlaps`, () => {
				const rects = layoutRects(getDefaultTouchLayout(s.o), s.w, s.h, scale);
				const out = resolveOverlaps(rects, { x: 4, y: 4, w: s.w - 8, h: s.h - 8 });
				expect(overlappingPairs(out, CONTROL_GAP - 1)).toEqual([]);
				expect(out.every((r) => inside(r, s.w, s.h))).toBe(true);
			});
		}
	}
});
