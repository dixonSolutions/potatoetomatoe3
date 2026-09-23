<script lang="ts">
	/**
	 * Launch bench for the play path (dev builds only).
	 *
	 * Launches a list of catalog games one after another through the app's real play-URL
	 * resolution, the way the game page does after a card click, and times each one:
	 * resolve → frame `load` → first game-sized canvas in any frame. The canvas report
	 * comes from inside the (usually cross-origin) game frames via the frame probe, which
	 * `scripts/play-path-bench.mjs` injects through Playwright in Chromium and through
	 * `POTATO_TOMATO_FRAME_PROBE` in the Tauri debug build. Results go to that script's
	 * collector, so nothing here needs a screenshot of the window.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getGamePlayerUrl, iframeAllowForUrl, loadGameMetadata } from '$lib/utils/games';
	import { clearDirectLaunchFailed } from '$lib/utils/online-play-routing';

	type ProbeReport = {
		type: 'pt-frame-probe';
		kind: 'load' | 'canvas';
		href: string;
		depth: number;
		at: number;
		bridge?: boolean;
		bridgeGameId?: string;
		virtual?: boolean;
		nativeBridge?: boolean;
		nativeRole?: string;
		w?: number;
		h?: number;
	};

	type BenchConfig = {
		ids: string[];
		label: string;
		timeoutMs: number;
		stallMs: number;
		/** Keep a painted game running this long, so late frames still report. */
		settleMs: number;
	};

	type LaunchResult = {
		id: string;
		label: string;
		urls: string[];
		resolveMs: number | null;
		loadMs: number | null;
		canvasMs: number | null;
		canvasHref: string;
		canvasDepth: number | null;
		stalled: boolean;
		error: string;
		frames: Array<Omit<ProbeReport, 'type' | 'at'> & { ms: number }>;
	};

	const DEFAULT_STALL_MS = 25_000;

	let collector = $state('');
	let status = $state('Waiting for config…');
	let results = $state<LaunchResult[]>([]);
	let frameUrl = $state('');
	let frameAllow = $state<string | undefined>(undefined);
	let frameKey = $state(0);

	let onFrameLoad: (() => void) | null = null;

	function collectorUrl(path: string): string {
		return `${collector}${path}`;
	}

	async function post(path: string, body: unknown) {
		try {
			await fetch(collectorUrl(path), {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: JSON.stringify(body)
			});
		} catch {
			/* collector gone — the run is over anyway */
		}
	}

	function sleep(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}

	async function launch(id: string, config: BenchConfig): Promise<LaunchResult> {
		const result: LaunchResult = {
			id,
			label: config.label,
			urls: [],
			resolveMs: null,
			loadMs: null,
			canvasMs: null,
			canvasHref: '',
			canvasDepth: null,
			stalled: false,
			error: '',
			frames: []
		};
		clearDirectLaunchFailed(id);
		const t0 = Date.now();
		let canvasSeen: (() => void) | null = null;
		const onProbe = (event: MessageEvent) => {
			const data = event.data as ProbeReport | null;
			if (!data || data.type !== 'pt-frame-probe') return;
			const ms = data.at - t0;
			const { type: _type, at: _at, ...rest } = data;
			void _type;
			void _at;
			result.frames.push({ ...rest, ms });
			if (data.kind === 'canvas' && result.canvasMs === null) {
				result.canvasMs = ms;
				result.canvasHref = data.href;
				result.canvasDepth = data.depth;
				canvasSeen?.();
			}
		};
		window.addEventListener('message', onProbe);
		try {
			const metadata = await loadGameMetadata(id);
			const url = await getGamePlayerUrl(id, metadata);
			result.resolveMs = Date.now() - t0;
			result.urls.push(url);
			const loaded = new Promise<void>((resolve) => {
				onFrameLoad = resolve;
			});
			const painted = new Promise<void>((resolve) => {
				canvasSeen = resolve;
			});
			frameAllow = iframeAllowForUrl(url);
			frameUrl = url;
			frameKey++;
			const stallMs = config.stallMs || DEFAULT_STALL_MS;
			const loadOutcome = await Promise.race([
				loaded.then(() => 'loaded' as const),
				sleep(stallMs).then(() => 'stalled' as const)
			]);
			if (loadOutcome === 'loaded') {
				result.loadMs = Date.now() - t0;
			} else {
				result.stalled = true;
			}
			const remaining = Math.max(0, config.timeoutMs - (Date.now() - t0));
			await Promise.race([painted, sleep(remaining)]);
			if (result.canvasMs !== null && config.settleMs > 0) await sleep(config.settleMs);
		} catch (e) {
			result.error = e instanceof Error ? e.message : String(e);
		} finally {
			window.removeEventListener('message', onProbe);
			onFrameLoad = null;
			frameUrl = '';
			frameKey++;
		}
		return result;
	}

	onMount(() => {
		const port = $page.url.searchParams.get('collector') || '18795';
		collector = `http://127.0.0.1:${port}`;
		void (async () => {
			let config: BenchConfig;
			try {
				const res = await fetch(collectorUrl('/config'));
				config = (await res.json()) as BenchConfig;
			} catch (e) {
				status = `No collector on ${collector}: ${e instanceof Error ? e.message : e}`;
				return;
			}
			await post('/hello', { userAgent: navigator.userAgent, origin: location.origin });
			for (let i = 0; i < config.ids.length; i++) {
				const id = config.ids[i]!;
				status = `${i + 1}/${config.ids.length} ${id}`;
				await post('/start', { id });
				const result = await launch(id, config);
				results = [...results, result];
				await post('/result', result);
				await sleep(500);
			}
			status = 'Done';
			await post('/done', { count: results.length });
		})();
	});
</script>

<div class="flex h-screen flex-col gap-2 p-2 text-xs">
	<div class="font-mono">{status}</div>
	<div class="relative min-h-0 flex-1 bg-black">
		{#key frameKey}
			{#if frameUrl}
				<iframe
					src={frameUrl}
					title="bench"
					class="h-full w-full border-0"
					allowfullscreen
					allow={frameAllow || 'fullscreen; autoplay; gamepad; microphone; camera'}
					referrerpolicy="no-referrer-when-downgrade"
					onload={() => onFrameLoad?.()}
				></iframe>
			{/if}
		{/key}
	</div>
	<ol class="max-h-40 overflow-auto font-mono">
		{#each results as r (r.id)}
			<li>
				{r.id}: resolve {r.resolveMs ?? '–'}ms, load {r.loadMs ?? '–'}ms, canvas {r.canvasMs ??
					'–'}ms {r.error}
			</li>
		{/each}
	</ol>
</div>
