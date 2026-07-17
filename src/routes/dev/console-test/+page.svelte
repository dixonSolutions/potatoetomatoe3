<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import LazyGameFrame from '$lib/components/game-player/LazyGameFrame.svelte';
	import TouchConsole from '$lib/components/game-player/touch-console/TouchConsole.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import HealthStrip from '$lib/components/dev-harness/HealthStrip.svelte';
	import GamePicker from '$lib/components/dev-harness/GamePicker.svelte';
	import TimelinePanel from '$lib/components/dev-harness/TimelinePanel.svelte';
	import LogExportBar from '$lib/components/dev-harness/LogExportBar.svelte';
	import CommandPanel from '$lib/components/dev-harness/CommandPanel.svelte';
	import { HARNESS_TEST_GAMES } from '$lib/dev-harness/test-games';
	import {
		CONSOLE_COMMAND_HELP,
		parseConsoleCommand,
		type ConsoleCommandName
	} from '$lib/dev-harness/commands';
	import { createAckId, waitForDispatchAck } from '$lib/dev-harness/dispatch-ack';
	import { createTimelineEntry, type TimelineEntry } from '$lib/dev-harness/timeline';
	import { getGamePlayerUrl, loadGameMetadata, resolveGameThumbnailSrc } from '$lib/utils/games';
	import { saveGamePlayMode, type GamePlayMode } from '$lib/utils/game-play-mode';
	import {
		KeyDispatcher,
		canUseTouchBridge,
		isLikelyInjectableUrl,
		resolveInjectable
	} from '$lib/utils/touch-input-dispatch';
	import { DEFAULT_TOUCH_MAPPING } from '$lib/utils/touch-console';
	import { applyPauseToGameIframe } from '$lib/utils/game-pause';
	import { broadcastGameAudioOutput, unlockGameIframeAudio } from '$lib/utils/game-audio';
	import {
		fetchPullerOfflineStatusesForIds,
		type GameOfflineStatus
	} from '$lib/utils/offline-downloader-puller';
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
	import type { TouchKeyCode } from '$lib/utils/touch-console';

	const games = HARNESS_TEST_GAMES;
	const dispatcher = new KeyDispatcher();

	let selectedId = $state(games[0]?.id ?? 'shrek-escape');
	let playMode = $state<GamePlayMode>('online');
	let playerUrl = $state('');
	let posterUrl = $state('');
	let title = $state('Console Test');
	let started = $state(false);
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let consoleVisible = $state(true);
	let chromeAvailable = $state(false);
	let statuses = $state<Record<string, GameOfflineStatus>>({});
	let timeline = $state<TimelineEntry[]>([]);
	let probeSummary = $state('Not probed');
	let frameKey = $state(0);
	let resolving = $state(false);

	const helpLines = Object.values(CONSOLE_COMMAND_HELP);
	const presets = [
		{ label: 'Probe', command: 'probe' },
		{ label: 'Space', command: 'tap Space' },
		{ label: 'ArrowUp', command: 'tap ArrowUp' },
		{ label: 'WASD up', command: 'down KeyW' },
		{ label: 'Release', command: 'releaseAll' },
		{ label: 'Pause', command: 'pause' },
		{ label: 'Resume', command: 'resume' }
	];

	function pushTimeline(level: TimelineEntry['level'], label: string, detail?: string) {
		/* untrack so callers from effects never subscribe to timeline and loop */
		untrack(() => {
			timeline = [...timeline, createTimelineEntry(level, label, detail)];
		});
		appendPlayLog(
			level === 'success'
				? 'info'
				: level === 'error'
					? 'error'
					: level === 'warn'
						? 'warn'
						: 'info',
			'harness-manual',
			label,
			detail ? `game=${selectedId} ${detail}` : `game=${selectedId}`
		);
	}

	async function refreshStatuses() {
		statuses = await fetchPullerOfflineStatusesForIds(
			games.map((g) => g.id),
			true
		);
	}

	async function resolvePlayer(options?: { keepStarted?: boolean }) {
		if (resolving) return;
		resolving = true;
		const keepStarted = options?.keepStarted ?? false;
		try {
			saveGamePlayMode(selectedId, playMode);
			const meta = await loadGameMetadata(selectedId);
			title = meta?.name ?? selectedId;
			posterUrl = resolveGameThumbnailSrc(meta?.thumbnail, { gameId: selectedId });
			playerUrl = await getGamePlayerUrl(selectedId);
			if (!keepStarted) {
				started = false;
				iframeEl = null;
			}
			frameKey += 1;
			pushTimeline(
				'info',
				`Resolved ${playMode} play URL`,
				`url=${playerUrl} injectableHint=${isLikelyInjectableUrl(playerUrl)} bridgeHint=${canUseTouchBridge(playerUrl)}`
			);
		} finally {
			resolving = false;
		}
	}

	function setPlayMode(mode: GamePlayMode) {
		if (playMode === mode) return;
		playMode = mode;
		void resolvePlayer();
	}

	function onGameSelect(id: string) {
		selectedId = id;
		void resolvePlayer();
	}

	function wireDispatcher() {
		if (!iframeEl) {
			dispatcher.setTarget(null);
			dispatcher.setBridgeFrame(null);
			probeSummary = 'No iframe';
			return dispatcher.getDispatchPathKind();
		}
		const injectable = resolveInjectable(iframeEl);
		if (injectable) {
			dispatcher.setTarget(injectable);
			probeSummary = `DOM path · depth=${injectable.depth} · canvas=${injectable.canvas ? 'yes' : 'no'}`;
			return 'dom' as const;
		}
		if (canUseTouchBridge(playerUrl) || isLikelyInjectableUrl(playerUrl)) {
			dispatcher.setBridgeFrame(iframeEl);
			probeSummary = 'Bridge path · postMessage potato-tomato-touch-input';
			return 'bridge' as const;
		}
		dispatcher.setTarget(null);
		dispatcher.setBridgeFrame(null);
		probeSummary = 'No dispatch path (shell-only or blocked URL)';
		return 'none' as const;
	}

	async function dispatchWithAck(
		action: 'down' | 'up' | 'releaseAll',
		codes: TouchKeyCode[],
		run: () => void
	) {
		const path = wireDispatcher();
		const ackId = createAckId();
		pushTimeline(
			'info',
			`Command accepted: ${action}`,
			`ackId=${ackId} path=${path} codes=${codes.join(',')}`
		);
		const wait = waitForDispatchAck({
			ackId,
			path,
			domCodes: codes,
			iframeWin: iframeEl?.contentWindow ?? null
		});
		dispatcher.setPendingAckId(ackId);
		run();
		const result = await wait;
		if (result.status === 'ok') {
			pushTimeline(
				'success',
				`Ack OK (${'path' in result.ack ? result.ack.path : path})`,
				`ackId=${ackId} codes=${('codes' in result.ack ? result.ack.codes : codes).join(',')}`
			);
		} else if (result.status === 'timeout') {
			pushTimeline('warn', 'Ack timeout', `ackId=${ackId} path=${path}`);
		} else {
			pushTimeline('warn', 'Ack skipped', result.reason);
		}
	}

	async function runConsoleCommand(raw: string) {
		const parsed = parseConsoleCommand(raw);
		if ('error' in parsed) {
			pushTimeline('error', 'Parse error', parsed.error);
			return;
		}
		await executeConsoleCommand(parsed.name, parsed.args);
	}

	async function executeConsoleCommand(name: ConsoleCommandName, args: string[]) {
		switch (name) {
			case 'probe': {
				const path = wireDispatcher();
				pushTimeline('info', 'Probe complete', `${probeSummary} · path=${path}`);
				return;
			}
			case 'reload': {
				await resolvePlayer();
				started = true;
				pushTimeline('info', 'Frame reloaded');
				return;
			}
			case 'down': {
				const codes = args as TouchKeyCode[];
				await dispatchWithAck('down', codes, () => dispatcher.down(codes));
				return;
			}
			case 'up': {
				const codes = args as TouchKeyCode[];
				await dispatchWithAck('up', codes, () => dispatcher.up(codes));
				return;
			}
			case 'tap': {
				const codes = args as TouchKeyCode[];
				await dispatchWithAck('down', codes, () => dispatcher.down(codes));
				await new Promise((r) => setTimeout(r, 80));
				await dispatchWithAck('up', codes, () => dispatcher.up(codes));
				return;
			}
			case 'joystick': {
				const x = Number(args[0]);
				const y = Number(args[1]);
				const codes = KeyDispatcher.directionsFromVector(
					x,
					y,
					DEFAULT_TOUCH_MAPPING.directions
				);
				const path = wireDispatcher();
				dispatcher.setJoystickCodes(codes);
				pushTimeline(
					'info',
					`Joystick (${x}, ${y})`,
					`path=${path} codes=${codes.join(',') || '(deadzone)'}`
				);
				return;
			}
			case 'releaseAll': {
				await dispatchWithAck('releaseAll', [], () => dispatcher.releaseAll());
				return;
			}
			case 'pause': {
				applyPauseToGameIframe(iframeEl, true);
				pushTimeline('info', 'Pause sent');
				return;
			}
			case 'resume': {
				applyPauseToGameIframe(iframeEl, false);
				pushTimeline('info', 'Resume sent');
				return;
			}
			case 'unlockAudio': {
				unlockGameIframeAudio(iframeEl);
				pushTimeline('info', 'Audio unlock sent');
				return;
			}
			case 'mute': {
				broadcastGameAudioOutput(true);
				pushTimeline('info', 'Mute sent');
				return;
			}
			case 'unmute': {
				broadcastGameAudioOutput(false);
				pushTimeline('info', 'Unmute sent');
				return;
			}
		}
	}

	onMount(() => {
		void refreshStatuses();
		void resolvePlayer();
		const id = window.setInterval(() => void refreshStatuses(), 5000);
		return () => window.clearInterval(id);
	});

	const snapshotLines = $derived([
		`harness=console-test`,
		`game=${selectedId}`,
		`mode=${playMode}`,
		`url=${playerUrl || '(none)'}`,
		`probe=${probeSummary}`,
		`consoleChrome=${chromeAvailable}`,
		`started=${started}`
	]);
</script>

<svelte:head>
	<title>Console Test (dev)</title>
</svelte:head>

<div class="flex min-h-screen flex-col gap-4 p-4 lg:p-6">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<div class="flex items-center gap-2">
				<h1 class="text-xl font-semibold tracking-tight">Console Test</h1>
				<Badge variant="secondary">dev</Badge>
			</div>
			<p class="max-w-2xl text-sm text-muted-foreground">
				Touch injection into puller-proxied online and offline games — production dispatcher +
				bridge.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<ToggleGroup.Root
				type="single"
				variant="outline"
				size="sm"
				value={playMode}
				onValueChange={(v) => {
					if (v === 'online' || v === 'offline') setPlayMode(v);
				}}
			>
				<ToggleGroup.Item value="online" aria-label="Online play">Online</ToggleGroup.Item>
				<ToggleGroup.Item value="offline" aria-label="Offline play">Offline</ToggleGroup.Item>
			</ToggleGroup.Root>
			<Button
				type="button"
				size="sm"
				variant={consoleVisible ? 'default' : 'outline'}
				onclick={() => (consoleVisible = !consoleVisible)}
			>
				Console {consoleVisible ? 'on' : 'off'}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				disabled={resolving || !playerUrl}
				onclick={() => {
					started = true;
				}}
			>
				Play
			</Button>
		</div>
	</header>

	<HealthStrip gameId={selectedId} />

	<div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
		<aside class="space-y-3">
			<Card.Root>
				<Card.Header class="pb-3">
					<Card.Title class="text-base">Game</Card.Title>
				</Card.Header>
				<Card.Content>
					<GamePicker
						{games}
						bind:selectedId
						{statuses}
						onSelect={onGameSelect}
					/>
				</Card.Content>
			</Card.Root>

			<CommandPanel
				placeholder="tap Space · joystick 0 -1 · probe"
				{helpLines}
				{presets}
				onSubmit={runConsoleCommand}
			/>

			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Title class="text-base">Injection status</Card.Title>
				</Card.Header>
				<Card.Content>
					<p class="font-mono text-xs text-muted-foreground">{probeSummary}</p>
				</Card.Content>
			</Card.Root>

			<LogExportBar
				gameId={selectedId}
				{snapshotLines}
				{timeline}
				filename={`console-test-${selectedId}.txt`}
			/>
		</aside>

		<section class="flex min-h-0 flex-col gap-2">
			<Card.Root class="overflow-hidden p-0">
				<div class="relative h-[min(62vh,560px)] w-full bg-black">
					{#if playerUrl}
						{#key frameKey}
							<LazyGameFrame
								gameUrl={playerUrl}
								gameId={selectedId}
								{title}
								{posterUrl}
								fillContainer
								bind:started
								onIframeReady={(el) => {
									iframeEl = el;
									if (el) {
										el.addEventListener(
											'load',
											() => {
												wireDispatcher();
												pushTimeline('info', 'Iframe loaded', probeSummary);
											},
											{ once: true }
										);
									}
								}}
							/>
						{/key}
						{#if started}
							<TouchConsole
								iframe={iframeEl}
								gameId={selectedId}
								{playerUrl}
								{started}
								visible={consoleVisible}
								bind:chromeAvailable
								onRequestShow={() => {
									consoleVisible = true;
								}}
							/>
						{/if}
					{:else}
						<div
							class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
						>
							{resolving ? 'Resolving play URL…' : 'No play URL yet.'}
						</div>
					{/if}
				</div>
			</Card.Root>
			<p class="text-xs text-muted-foreground">
				Use the poster <strong>Play</strong> button (or the toolbar Play) to start the frame. Manual
				commands share <code class="font-mono">KeyDispatcher</code> with the overlay.
			</p>
		</section>

		<aside class="flex min-h-[280px] flex-col xl:min-h-0">
			<TimelinePanel entries={timeline} />
		</aside>
	</div>

	<Separator />
</div>
