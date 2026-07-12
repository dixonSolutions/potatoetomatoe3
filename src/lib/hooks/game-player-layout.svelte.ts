import { browser } from '$app/environment';

const COMPACT_BREAKPOINT = 768;

/** Reactive viewport sizing for the game player surface (inline, non-fullscreen). */
export class GamePlayerLayout {
	width = $state(0);
	height = $state(0);

	constructor() {
		if (!browser) return;
		this.sync();
		window.addEventListener('resize', this.sync);
		window.addEventListener('orientationchange', this.sync);
	}

	sync = () => {
		this.width = window.innerWidth;
		this.height = window.innerHeight;
	};

	destroy() {
		if (!browser) return;
		window.removeEventListener('resize', this.sync);
		window.removeEventListener('orientationchange', this.sync);
	}

	get isCompact(): boolean {
		return this.width > 0 && this.width < COMPACT_BREAKPOINT;
	}

	get isPortrait(): boolean {
		return this.height >= this.width;
	}

	/** Pixel height for the inline player on compact viewports. */
	get inlineHeightPx(): number | undefined {
		if (!this.isCompact || this.width <= 0 || this.height <= 0) return undefined;

		if (this.isPortrait) {
			return Math.round(Math.min(this.height * 0.44, this.width * 1.05));
		}
		return Math.round(Math.min(this.height * 0.72, (this.width * 9) / 16));
	}

	get surfaceStyle(): string | undefined {
		const h = this.inlineHeightPx;
		if (h == null) return undefined;
		return `height: ${h}px; width: 100%;`;
	}
}
