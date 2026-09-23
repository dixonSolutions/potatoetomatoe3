<script lang="ts">
	/**
	 * Engine perf bench (dev only): the same games and the same TouchConsole, measured from
	 * inside the page so it runs unchanged in the Tauri webview, in a bare WebKitGTK view
	 * and in any Chromium.
	 *
	 * Per workload it records load time, frame pacing with the console hidden and shown,
	 * the workload's own per-frame script time, and console latency: synthetic press on the
	 * real console widget → keydown seen in the game document → the game's next animation
	 * frames. After the workloads it times a cold fetch + `WebAssembly.compile` of Shrek's
	 * 32 MB module. Results POST to `scripts/perf-bench-collector.mjs`, which also reports
	 * the host's load average at the start and after every workload.
	 *
	 * Query:
	 *   engine=<label>     names the run (file name in the collector)
	 *   variant=<label>    free-form tag for the configuration under test; `collector` takes the
	 *                      label (and extra query options) from the collector's POST /tag
	 *   delay=<ms>         wait before the first workload (default 0)
	 *   auto=1             start on mount
	 *   collector=<url>    collector base (default http://127.0.0.1:18799)
	 *   workloads=a,b      subset of workload ids, in that order
	 *   sample=<ms>        frame-sampling window per phase (default 15000)
	 *   settle=<ms>        wait after load before sampling (default 5000)
	 *   taps=<n>           presses per latency series (default 60)
	 *   latency=0          skip the latency series (frame pacing only)
	 *   console=0          skip the console-shown frame phase
	 *   warm=0             skip Unity's second (warm-cache) load
	 *   wasm=0             skip the WebAssembly compile timing
	 *   quick=1            short phases, for smoke runs
	 */
	import { onMount, tick } from 'svelte';
	import TouchConsole from '$lib/components/game-player/touch-console/TouchConsole.svelte';
	import { KeyDispatcher } from '$lib/utils/touch-input-dispatch';

	type Workload = { id: string; label: string; url: string; unity: boolean };

	/*
	 * Unity's loader fetches this name. The `.br` one next to it is the same raw wasm, but
	 * Vite serves it with `Content-Encoding: br`, so a fetch of it fails to decode.
	 */
	const SHREK_WASM = '/games/shrek-escape/offline/Build/Shrek2.wasm';

	const ALL_WORKLOADS: Workload[] = [
		{
			id: 'shrek-unity',
			label: 'Shrek Escape (Unity WebGL 2, 3D menu scene)',
			url: '/games/shrek-escape/offline/index.html',
			unity: true
		},
		{
			id: 'sprites-canvas',
			label: 'Canvas 2D, 3000 drawImage sprites + tiles + text (typical 2D catalog game)',
			url: '/dev-bench/sprites.html?renderer=canvas&count=3000',
			unity: false
		},
		{
			id: 'sprites-canvas-heavy',
			label: 'Canvas 2D, 10000 drawImage sprites (throughput)',
			url: '/dev-bench/sprites.html?renderer=canvas&count=10000',
			unity: false
		},
		{
			id: 'sprites-webgl',
			label: 'WebGL 1 batched sprites, 20000 (Pixi / Phaser 3 / Construct 3 style)',
			url: '/dev-bench/sprites.html?renderer=webgl&count=20000',
			unity: false
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
	const collectorBase = (params.get('collector') ?? 'http://127.0.0.1:18799').replace(
		/\/result\/?$/,
		''
	);

	/** Everything a run can be told, from the query (plus the collector's, see `run`). */
	function readOptions(q: URLSearchParams) {
		const quick = q.get('quick') === '1';
		const num = (key: string, fallback: number) => {
			const v = Number(q.get(key));
			return q.has(key) && Number.isFinite(v) && v >= 0 ? v : fallback;
		};
		const pick = q.get('workloads');
		return {
			variant: q.get('variant') ?? 'default',
			quick,
			delayMs: num('delay', 0),
			sampleMs: num('sample', quick ? 4000 : 15000),
			settleMs: num('settle', quick ? 1500 : 5000),
			taps: num('taps', quick ? 15 : 60),
			latency: q.get('latency') !== '0',
			consolePhase: q.get('console') !== '0',
			unityWarm: q.get('warm') !== '0',
			wasmCompile: q.get('wasm') !== '0',
			workloads: pick
				? pick
						.split(',')
						.map((id) => ALL_WORKLOADS.find((w) => w.id === id.trim()))
						.filter((w): w is Workload => Boolean(w))
				: ALL_WORKLOADS
		};
	}
	let opts = $state.raw(readOptions(params));

	let workload = $state<Workload>(ALL_WORKLOADS[0]);
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
		/* Progress to the collector, so a harness can tell a slow run from a dead one. */
		void fetch(`${collectorBase}/progress`, {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: `${engine}/${opts.variant}: ${line}`
		}).catch(() => {});
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

	/** Host load and identity from the collector; null when it is not running. */
	async function hostSnapshot(): Promise<Record<string, unknown> | null> {
		try {
			const res = await fetch(`${collectorBase}/env`, { cache: 'no-store' });
			return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
		} catch {
			return null;
		}
	}

	type BenchWork = { scriptMs: number[]; frames: number; mode?: string; count?: number };
	type GameWin = Window & {
		performance: Performance;
		requestAnimationFrame: typeof requestAnimationFrame;
		__benchKeys?: { code: string; t: number; tFrame?: number; tFrame2?: number }[];
		__benchKeyHook?: boolean;
		__benchWork?: BenchWork;
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

	/** What the page is actually drawing into: the game's largest canvas and its backing store. */
	function gameSurface(win: GameWin) {
		try {
			const canvases = [...win.document.querySelectorAll('canvas')];
			const c = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
			if (!c) return null;
			return {
				backing: `${c.width}x${c.height}`,
				css: `${c.clientWidth}x${c.clientHeight}`,
				gameDpr: win.devicePixelRatio
			};
		} catch {
			return null;
		}
	}

	/** Visible + focused is what keeps every engine's rAF unthrottled; record it per phase. */
	function pageState(win: GameWin | null) {
		return {
			visibility: document.visibilityState,
			focus: document.hasFocus(),
			gameVisibility: win?.document?.visibilityState ?? null
		};
	}

	async function sampleFrames(win: GameWin, ms: number) {
		const intervals: number[] = [];
		let last = 0;
		let done = false;
		const work = win.__benchWork;
		const scriptFrom = work?.scriptMs.length ?? 0;
		const before = pageState(win);
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
		/* The workload's own per-frame script time over the same window (sprites, gl-scene). */
		const scriptMs = work ? stats(work.scriptMs.slice(scriptFrom)) : null;
		if (work && work.scriptMs.length > 4000) work.scriptMs.length = 0;
		return {
			fps: spanMs ? Math.round((intervals.length / (spanMs / 1000)) * 10) / 10 : 0,
			frameMs: s,
			jankOver25ms: intervals.filter((i) => i > 25).length,
			jankOver50ms: intervals.filter((i) => i > 50).length,
			scriptMs,
			state: { before, after: pageState(win) }
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
		for (let i = 0; i < opts.taps; i++) {
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
		for (let i = 0; i < opts.taps; i++) {
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
		for (let i = 0; i < opts.taps; i++) {
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

	function glInfo(kind: 'webgl2' | 'webgl') {
		try {
			const gl = document.createElement('canvas').getContext(kind) as WebGLRenderingContext | null;
			if (!gl) return null;
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			const info = {
				renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
				vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
				version: String(gl.getParameter(gl.VERSION)),
				maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
			};
			gl.getExtension('WEBGL_lose_context')?.loseContext();
			return info;
		} catch {
			return null;
		}
	}

	function environment() {
		return {
			engine,
			variant: opts.variant,
			userAgent: navigator.userAgent,
			webgl2: glInfo('webgl2'),
			webgl1: glInfo('webgl'),
			devicePixelRatio: window.devicePixelRatio,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			screen: `${screen.width}x${screen.height}`,
			gameBox: '1280x720 CSS px',
			hardwareConcurrency: navigator.hardwareConcurrency,
			deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
			crossOriginIsolated: window.crossOriginIsolated,
			state: pageState(null),
			options: { ...opts, workloads: opts.workloads.map((w) => w.id) },
			query: location.search
		};
	}

	async function navigateFrame(url: string) {
		consoleVisible = false;
		started = false;
		frameSrc = 'about:blank';
		await tick();
		await sleep(300);
		const t0 = epochNow();
		frameSrc = url;
		await tick();
		await new Promise<void>((resolve) => {
			const f = iframeEl!;
			const on = () => {
				f.removeEventListener('load', on);
				resolve();
			};
			f.addEventListener('load', on);
		});
		return t0;
	}

	/**
	 * Unity's "ready" is the whole cold start: fetching 64 MB of data and a 32 MB wasm
	 * module over loopback, compiling that module, and booting the first scene.
	 */
	async function startUnity(win: GameWin, t0: number) {
		win.document.querySelector<HTMLButtonElement>('#play-button')?.click();
		const end = performance.now() + 240000;
		while (!win.myGameInstance && performance.now() < end) await sleep(50);
		if (!win.myGameInstance) throw new Error('Unity instance never came up');
		return epochNow() - t0;
	}

	async function loadWorkload(w: Workload) {
		workload = w;
		const t0 = await navigateFrame(w.url);
		const htmlLoadedMs = epochNow() - t0;
		const win = gameWin()!;
		let readyMs = htmlLoadedMs;
		if (w.unity) readyMs = await startUnity(win, t0);
		else {
			/* The sprite scenes decode their atlas before the first frame. */
			const end = performance.now() + 10000;
			while (win.__benchWork && !win.__benchWork.frames && performance.now() < end) await sleep(10);
			readyMs = epochNow() - t0;
		}
		started = true;
		installKeyHook(win);
		return { htmlLoadedMs: Math.round(htmlLoadedMs), readyMs: Math.round(readyMs) };
	}

	/** Second Unity start in the same session: HTTP cache warm, same process, same GPU. */
	async function unityWarmReady(w: Workload) {
		const t0 = await navigateFrame(w.url);
		const ms = await startUnity(gameWin()!, t0);
		return Math.round(ms);
	}

	async function runWorkload(w: Workload) {
		note(`${w.id}: loading`);
		const load = await loadWorkload(w);
		note(`${w.id}: ready in ${load.readyMs} ms, settling`);
		const win = gameWin()!;
		await sleep(opts.settleMs);
		const surface = gameSurface(win);

		note(`${w.id}: frames, console hidden`);
		const consoleOff = await sampleFrames(win, opts.sampleMs);

		let consoleOn = null;
		let widgets = null;
		if (opts.consolePhase || opts.latency) {
			consoleVisible = true;
			await tick();
			await sleep(2000);
			widgets = {
				buttons: document.querySelectorAll('.pt-touch-btn').length,
				joystick: Boolean(document.querySelector('[data-testid="touch-joystick"]'))
			};
		}
		if (opts.consolePhase) {
			note(`${w.id}: frames, console shown (${widgets?.buttons} buttons)`);
			consoleOn = await sampleFrames(win, opts.sampleMs);
		}

		let latency = null;
		if (opts.latency) {
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
			latency = { button, joystick, bridge };
		}
		consoleVisible = false;

		let warmReadyMs = null;
		if (w.unity && opts.unityWarm) {
			note(`${w.id}: second (warm) load`);
			warmReadyMs = await unityWarmReady(w);
			note(`${w.id}: warm ready in ${warmReadyMs} ms`);
		}

		return {
			workload: w.id,
			label: w.label,
			load: { ...load, warmReadyMs },
			surface,
			widgets,
			frames: { consoleOff, consoleOn },
			latency,
			host: await hostSnapshot()
		};
	}

	/**
	 * Cold fetch + compile of Shrek's 32 MB module in the bench page itself. Both engines
	 * tier lazily (V8 Liftoff with lazy function compilation, JSC's in-place interpreter),
	 * so this is mostly parse + validate; Unity's ready time is the end-to-end number.
	 */
	async function wasmCompile() {
		const out: Record<string, number | string> = {};
		try {
			let t = performance.now();
			const res = await fetch(`${SHREK_WASM}?nocache=${Date.now()}`, { cache: 'no-store' });
			const bytes = await res.arrayBuffer();
			out.fetchMs = Math.round(performance.now() - t);
			out.bytes = bytes.byteLength;
			for (const k of ['compile1Ms', 'compile2Ms']) {
				t = performance.now();
				await WebAssembly.compile(bytes);
				out[k] = Math.round(performance.now() - t);
			}
		} catch (e) {
			out.error = String(e);
		}
		return out;
	}

	async function run() {
		if (status !== 'idle' && !status.startsWith('done')) return;
		log = [];
		status = 'starting';
		const results = [];
		let hostAtStart = await hostSnapshot();
		/*
		 * `variant=collector`: the harness labelled this run (and may add query options) on
		 * the collector. Tauri bakes its dev URL in at build time, so this is how runs that
		 * differ only in env vars get told apart without a rebuild per run.
		 */
		if (params.get('variant') === 'collector' && hostAtStart) {
			const merged: Record<string, string> = {
				...Object.fromEntries(params),
				...Object.fromEntries(new URLSearchParams(String(hostAtStart.benchQuery ?? ''))),
				variant: String(hostAtStart.benchTag ?? 'untagged')
			};
			opts = readOptions(new URLSearchParams(merged));
		}
		const env = environment();
		note(`engine=${engine} variant=${opts.variant} dpr=${env.devicePixelRatio}`);
		if (opts.delayMs) {
			/* Let the host's own startup (Tauri's puller spawn, first paints) finish first. */
			await sleep(opts.delayMs);
			hostAtStart = await hostSnapshot();
		}
		/*
		 * The bench page's own rAF rate with no game loaded: the display's pace as this engine
		 * sees it. Anything well under the refresh rate here (an occluded or unfocused window
		 * being throttled, a compositor not sending frame callbacks) makes every number after
		 * it meaningless, which is how the first Chromium run went wrong.
		 */
		note('baseline rAF (no game)');
		const baseline = await sampleFrames(window as unknown as GameWin, 3000);
		note(`baseline ${baseline.fps} fps`);
		for (const w of opts.workloads) {
			try {
				results.push(await runWorkload(w));
			} catch (e) {
				results.push({ workload: w.id, error: String(e), host: await hostSnapshot() });
				note(`${w.id}: FAILED ${String(e)}`);
			}
		}
		frameSrc = 'about:blank';
		await tick();
		let wasm = null;
		if (opts.wasmCompile) {
			await sleep(1000);
			note('wasm compile');
			wasm = await wasmCompile();
		}
		report = {
			at: new Date().toISOString(),
			env,
			hostAtStart,
			baseline,
			results,
			wasm,
			hostAtEnd: await hostSnapshot()
		};
		try {
			await fetch(`${collectorBase}/result`, {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: JSON.stringify(report)
			});
			note('done (posted to collector)');
		} catch (e) {
			note(`done (collector unreachable: ${String(e)})`);
		}
	}

	onMount(() => {
		if (params.get('auto') === '1') void run();
	});
</script>

<div class="flex flex-col gap-3 p-3 text-sm">
	<div class="flex items-center gap-3">
		<strong>Perf bench</strong>
		<span class="font-mono">engine={engine} variant={opts.variant}</span>
		<button class="rounded border px-2 py-1" onclick={() => void run()}>Run</button>
		<span class="font-mono text-muted-foreground" data-testid="bench-status">{status}</span>
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
