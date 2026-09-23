<script lang="ts">
	/**
	 * Engine perf bench (dev only): the same game and the same TouchConsole, measured from
	 * inside the page so it runs unchanged in the Tauri webview and in any Chromium.
	 *
	 * Per workload it records load time, frame pacing with the console hidden and shown,
	 * and console latency: synthetic press on the real console widget → keydown seen in
	 * the game document → the game's next animation frame. Results POST to
	 * `scripts/perf-bench-collector.mjs` when it is running.
	 *
	 * Query: `engine=<label>` names the run, `auto=1` starts it on mount,
	 * `collector=<url>` overrides the collector, `quick=1` shortens every phase.
	 */
	import { onMount, tick } from 'svelte';
	import TouchConsole from '$lib/components/game-player/touch-console/TouchConsole.svelte';
	import { KeyDispatcher } from '$lib/utils/touch-input-dispatch';

	type Workload = { id: string; label: string; url: string; unity: boolean };

	const WORKLOADS: Workload[] = [
		{
			id: 'shrek-unity',
			label: 'Shrek Escape (Unity WebGL 2, 3D menu scene)',
			url: '/games/shrek-escape/offline/index.html',
			unity: true
		},
		{
			id: 'gl-heavy',
			label: 'Synthetic WebGL 2, GPU-bound',
			url: '/dev-bench/gl-scene.html?load=heavy',
			unity: false
		},
		{
			id: 'gl-light',
			label: 'Synthetic WebGL 2, light (should hold vsync)',
			url: '/dev-bench/gl-scene.html?load=light',
			unity: false
		}
	];

	const params =
		typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
	const engine = params.get('engine') ?? 'unknown';
	const quick = params.get('quick') === '1';
	const collector = params.get('collector') ?? 'http://127.0.0.1:18799/result';
	const SAMPLE_MS = quick ? 4000 : 15000;
	const SETTLE_MS = quick ? 1500 : 5000;
	const TAPS = quick ? 15 : 60;

	let workload = $state<Workload>(WORKLOADS[0]);
	let frameSrc = $state('about:blank');
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let consoleVisible = $state(false);
	let started = $state(false);
	let status = $state('idle');
	let log = $state<string[]>([]);
	let report = $state<Record<string, unknown> | null>(null);

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const epochNow = () => performance.timeOrigin + performance.now();

	function note(line: string) {
		log = [...log, `${new Date().toISOString().slice(11, 19)} ${line}`];
		status = line;
	}

	function stats(values: number[]) {
		if (!values.length) return null;
		const s = [...values].sort((a, b) => a - b);
		const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
		const mean = s.reduce((a, b) => a + b, 0) / s.length;
		const r = (n: number) => Math.round(n * 100) / 100;
		return {
			n: s.length,
			mean: r(mean),
			p50: r(q(0.5)),
			p95: r(q(0.95)),
			p99: r(q(0.99)),
			max: r(s[s.length - 1])
		};
	}

	type GameWin = Window & {
		performance: Performance;
		requestAnimationFrame: typeof requestAnimationFrame;
		__benchKeys?: { code: string; t: number; tFrame?: number; tFrame2?: number }[];
		__benchKeyHook?: boolean;
		myGameInstance?: unknown;
		__benchScene?: unknown;
	};

	function gameWin(): GameWin | null {
		try {
			return (iframeEl?.contentWindow as GameWin | null) ?? null;
		} catch {
			return null;
		}
	}

	/** Timestamps in the game realm, converted to epoch ms so they compare with the parent. */
	function installKeyHook(win: GameWin) {
		if (win.__benchKeyHook) return;
		win.__benchKeyHook = true;
		win.__benchKeys = [];
		const now = () => win.performance.timeOrigin + win.performance.now();
		win.addEventListener(
			'keydown',
			(e: KeyboardEvent) => {
				const rec: { code: string; t: number; tFrame?: number; tFrame2?: number } = {
					code: e.code,
					t: now()
				};
				win.__benchKeys!.push(rec);
				win.requestAnimationFrame(() => {
					rec.tFrame = now();
					win.requestAnimationFrame(() => {
						rec.tFrame2 = now();
					});
				});
			},
			true
		);
	}

	async function sampleFrames(win: GameWin, ms: number) {
		const intervals: number[] = [];
		let last = 0;
		let done = false;
		const t0 = win.performance.now();
		await new Promise<void>((resolve) => {
			const step = (ts: number) => {
				if (last) intervals.push(ts - last);
				last = ts;
				if (ts - t0 >= ms) {
					done = true;
					resolve();
					return;
				}
				win.requestAnimationFrame(step);
			};
			win.requestAnimationFrame(step);
			/* A stalled frame loop must still end the phase. */
			setTimeout(() => {
				if (!done) resolve();
			}, ms + 5000);
		});
		const s = stats(intervals);
		const spanMs = intervals.reduce((a, b) => a + b, 0);
		return {
			fps: spanMs ? Math.round((intervals.length / (spanMs / 1000)) * 10) / 10 : 0,
			frameMs: s,
			jankOver25ms: intervals.filter((i) => i > 25).length,
			jankOver50ms: intervals.filter((i) => i > 50).length
		};
	}

	function pointer(el: Element, type: string, x: number, y: number) {
		const init: PointerEventInit = {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: x,
			clientY: y,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			pointerId: 7,
			pointerType: 'touch',
			isPrimary: true
		};
		el.dispatchEvent(new PointerEvent(type, init));
	}

	async function waitForKey(win: GameWin, since: number, timeoutMs = 1000) {
		const end = performance.now() + timeoutMs;
		while (performance.now() < end) {
			const rec = win.__benchKeys?.find((k) => k.t >= since);
			if (rec?.tFrame2) return rec;
			await sleep(5);
		}
		return win.__benchKeys?.find((k) => k.t >= since) ?? null;
	}

	type Lat = { toKey: number[]; toFrame: number[]; toFrame2: number[]; missed: number };
	const emptyLat = (): Lat => ({ toKey: [], toFrame: [], toFrame2: [], missed: 0 });

	function record(
		lat: Lat,
		t0: number,
		rec: { t: number; tFrame?: number; tFrame2?: number } | null
	) {
		if (!rec) {
			lat.missed++;
			return;
		}
		lat.toKey.push(rec.t - t0);
		if (rec.tFrame) lat.toFrame.push(rec.tFrame - t0);
		if (rec.tFrame2) lat.toFrame2.push(rec.tFrame2 - t0);
	}

	const latSummary = (lat: Lat) => ({
		dispatchToGameKeydownMs: stats(lat.toKey),
		dispatchToNextGameFrameMs: stats(lat.toFrame),
		dispatchToSecondGameFrameMs: stats(lat.toFrame2),
		missed: lat.missed
	});

	async function measureButton(win: GameWin): Promise<Lat> {
		const lat = emptyLat();
		const btn = document.querySelector<HTMLButtonElement>('.pt-touch-btn:not(:disabled)');
		if (!btn) {
			note('no console button found');
			return lat;
		}
		for (let i = 0; i < TAPS; i++) {
			const r = btn.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			const t0 = epochNow();
			pointer(btn, 'pointerdown', x, y);
			record(lat, t0, await waitForKey(win, t0));
			await sleep(60);
			pointer(btn, 'pointerup', x, y);
			await sleep(120 + Math.random() * 60);
		}
		return lat;
	}

	async function measureJoystick(win: GameWin): Promise<Lat> {
		const lat = emptyLat();
		const joy = document.querySelector<HTMLElement>('[data-testid="touch-joystick"]');
		if (!joy) {
			note('no joystick found');
			return lat;
		}
		for (let i = 0; i < TAPS; i++) {
			const r = joy.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			pointer(joy, 'pointerdown', cx, cy);
			await sleep(30);
			const t0 = epochNow();
			pointer(joy, 'pointermove', cx + r.width / 2, cy);
			record(lat, t0, await waitForKey(win, t0));
			await sleep(60);
			pointer(joy, 'pointerup', cx + r.width / 2, cy);
			await sleep(120 + Math.random() * 60);
		}
		return lat;
	}

	/** The postMessage bridge the packaged app uses for cross-origin (loopback puller) frames. */
	async function measureBridge(win: GameWin): Promise<Lat> {
		const lat = emptyLat();
		if (!iframeEl) return lat;
		const bridge = new KeyDispatcher();
		bridge.setBridgeFrame(iframeEl);
		for (let i = 0; i < TAPS; i++) {
			const t0 = epochNow();
			bridge.down(['KeyZ']);
			record(lat, t0, await waitForKey(win, t0));
			await sleep(60);
			bridge.up(['KeyZ']);
			await sleep(120 + Math.random() * 60);
		}
		bridge.releaseAll();
		return lat;
	}

	function environment() {
		let renderer = 'n/a';
		let vendor = 'n/a';
		try {
			const gl = document.createElement('canvas').getContext('webgl2');
			const ext = gl?.getExtension('WEBGL_debug_renderer_info');
			if (gl && ext) {
				renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
				vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
			}
		} catch {
			/* ignore */
		}
		return {
			engine,
			userAgent: navigator.userAgent,
			webglRenderer: renderer,
			webglVendor: vendor,
			devicePixelRatio: window.devicePixelRatio,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			hardwareConcurrency: navigator.hardwareConcurrency,
			quick
		};
	}

	async function loadWorkload(w: Workload) {
		workload = w;
		consoleVisible = false;
		started = false;
		frameSrc = 'about:blank';
		await tick();
		await sleep(300);
		const t0 = epochNow();
		frameSrc = w.url;
		await tick();
		await new Promise<void>((resolve) => {
			const f = iframeEl!;
			const on = () => {
				f.removeEventListener('load', on);
				resolve();
			};
			f.addEventListener('load', on);
		});
		const htmlLoadedMs = epochNow() - t0;
		const win = gameWin()!;
		let readyMs = htmlLoadedMs;
		if (w.unity) {
			win.document.querySelector<HTMLButtonElement>('#play-button')?.click();
			const end = performance.now() + 240000;
			while (!win.myGameInstance && performance.now() < end) await sleep(50);
			if (!win.myGameInstance) throw new Error('Unity instance never came up');
			readyMs = epochNow() - t0;
		}
		started = true;
		installKeyHook(win);
		return { htmlLoadedMs: Math.round(htmlLoadedMs), readyMs: Math.round(readyMs) };
	}

	async function runWorkload(w: Workload) {
		note(`${w.id}: loading`);
		const load = await loadWorkload(w);
		note(`${w.id}: ready in ${load.readyMs} ms, settling`);
		const win = gameWin()!;
		await sleep(SETTLE_MS);

		note(`${w.id}: frames, console hidden`);
		const consoleOff = await sampleFrames(win, SAMPLE_MS);

		consoleVisible = true;
		await tick();
		await sleep(2000);
		const widgets = {
			buttons: document.querySelectorAll('.pt-touch-btn').length,
			joystick: Boolean(document.querySelector('[data-testid="touch-joystick"]'))
		};
		note(`${w.id}: frames, console shown (${widgets.buttons} buttons)`);
		const consoleOn = await sampleFrames(win, SAMPLE_MS);

		note(`${w.id}: console button latency`);
		const button = latSummary(await measureButton(win));
		note(`${w.id}: joystick latency`);
		const joystick = latSummary(await measureJoystick(win));
		/* The child bridge only installs on real game paths (`/games/<id>/…`). */
		let bridge = null;
		if (w.unity) {
			note(`${w.id}: postMessage bridge latency`);
			bridge = latSummary(await measureBridge(win));
		}

		consoleVisible = false;
		return {
			workload: w.id,
			label: w.label,
			load,
			widgets,
			frames: { consoleOff, consoleOn },
			latency: { button, joystick, bridge }
		};
	}

	async function run() {
		if (status !== 'idle' && status !== 'done') return;
		log = [];
		const results = [];
		const env = environment();
		note(`engine=${engine} renderer=${env.webglRenderer}`);
		for (const w of WORKLOADS) {
			try {
				results.push(await runWorkload(w));
			} catch (e) {
				results.push({ workload: w.id, error: String(e) });
				note(`${w.id}: FAILED ${String(e)}`);
			}
		}
		frameSrc = 'about:blank';
		report = { at: new Date().toISOString(), env, results };
		try {
			await fetch(collector, {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: JSON.stringify(report)
			});
			note('done (posted to collector)');
		} catch (e) {
			note(`done (collector unreachable: ${String(e)})`);
		}
		status = 'done';
	}

	onMount(() => {
		if (params.get('auto') === '1') void run();
	});
</script>

<div class="flex flex-col gap-3 p-3 text-sm">
	<div class="flex items-center gap-3">
		<strong>Perf bench</strong>
		<span class="font-mono">engine={engine}</span>
		<button class="rounded border px-2 py-1" onclick={() => void run()}>Run</button>
		<span class="font-mono text-muted-foreground">{status}</span>
	</div>

	<div
		class="relative overflow-hidden rounded border bg-black"
		style="width:1280px;height:720px;flex:none"
	>
		<iframe
			bind:this={iframeEl}
			src={frameSrc}
			title={workload.label}
			class="game-player-surface__frame absolute inset-0 h-full w-full border-0"
			allow="autoplay; fullscreen; gamepad"
		></iframe>
		<TouchConsole
			iframe={iframeEl}
			gameId={`perf-bench-${workload.id}`}
			playerUrl={workload.url}
			{started}
			visible={consoleVisible}
		/>
	</div>

	<pre class="max-h-64 overflow-auto rounded border p-2 font-mono text-xs">{log.join('\n')}</pre>
	{#if report}
		<pre class="max-h-96 overflow-auto rounded border p-2 font-mono text-xs">{JSON.stringify(
				report,
				null,
				2
			)}</pre>
	{/if}
</div>
