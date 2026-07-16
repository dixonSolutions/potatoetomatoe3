<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import LazyGameFrame from '$lib/components/game-player/LazyGameFrame.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Progress } from '$lib/components/ui/progress';
	import HealthStrip from '$lib/components/dev-harness/HealthStrip.svelte';
	import GamePicker from '$lib/components/dev-harness/GamePicker.svelte';
	import TimelinePanel from '$lib/components/dev-harness/TimelinePanel.svelte';
	import LogExportBar from '$lib/components/dev-harness/LogExportBar.svelte';
	import CommandPanel from '$lib/components/dev-harness/CommandPanel.svelte';
	import { HARNESS_TEST_GAMES } from '$lib/dev-harness/test-games';
	import {
		PULLER_COMMAND_HELP,
		parsePullerCommand,
		type PullerCommandName
	} from '$lib/dev-harness/commands';
	import { createTimelineEntry, type TimelineEntry } from '$lib/dev-harness/timeline';
	import { getGamePlayerUrl, loadGameMetadata, resolveGameThumbnailSrc } from '$lib/utils/games';
	import { saveGamePlayMode } from '$lib/utils/game-play-mode';
	import {
		cancelPullerGameDownload,
		deletePullerOfflineCopy,
		fetchPullerDownloadProgress,
		fetchPullerGameOfflineStatus,
		fetchPullerHealth,
		fetchPullerJobs,
		fetchPullerOfflineStatusesForIds,
		getPullerBaseUrl,
		pollPullerDownloadUntilDone,
		startPullerGameDownload,
		type DownloadProgress,
		type GameOfflineStatus
	} from '$lib/utils/offline-downloader-puller';
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
	import { dispatchOfflineStatusChanged } from '$lib/utils/offline-status-events';

	const games = HARNESS_TEST_GAMES;

	let selectedId = $state(games[0]?.id ?? 'shrek-escape');
	let statuses = $state<Record<string, GameOfflineStatus>>({});
	let timeline = $state<TimelineEntry[]>([]);
	let progress = $state<DownloadProgress | null>(null);
	let lastJson = $state('');
	let playerUrl = $state('');
	let posterUrl = $state('');
	let title = $state('Puller Test');
	let started = $state(false);
	let frameKey = $state(0);
	let polling = $state(false);
	let resolving = $state(false);

	const helpLines = Object.values(PULLER_COMMAND_HELP);
	const presets = [
		{ label: 'Health', command: 'health' },
		{ label: 'Jobs', command: 'jobs' },
		{ label: 'Status', command: 'status' },
		{ label: 'Download', command: 'download' },
		{ label: 'Progress', command: 'progress' },
		{ label: 'Cancel', command: 'cancel' },
		{ label: 'Verify', command: 'verify' },
		{ label: 'Play online', command: 'playOnline' },
		{ label: 'Play offline', command: 'playOffline' }
	];

	function pushTimeline(level: TimelineEntry['level'], label: string, detail?: string) {
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
			'puller-download',
			label,
			detail ? `game=${selectedId} ${detail}` : `game=${selectedId}`
		);
	}

	function showJson(label: string, value: unknown) {
		lastJson = JSON.stringify(value, null, 2);
		pushTimeline('info', label, lastJson.slice(0, 1200));
	}

	async function refreshStatuses() {
		statuses = await fetchPullerOfflineStatusesForIds(
			games.map((g) => g.id),
			true
		);
	}

	async function resolvePlay(mode: 'online' | 'offline', autoStart = false) {
		if (resolving) return;
		resolving = true;
		try {
			saveGamePlayMode(selectedId, mode);
			const meta = await loadGameMetadata(selectedId);
			title = meta?.name ?? selectedId;
			posterUrl = resolveGameThumbnailSrc(meta?.thumbnail, { gameId: selectedId });
			playerUrl = await getGamePlayerUrl(selectedId);
			started = autoStart;
			frameKey += 1;
			pushTimeline('info', `Play URL (${mode})`, `url=${playerUrl}`);
		} finally {
			resolving = false;
		}
	}

	function onGameSelect(id: string) {
		selectedId = id;
		void resolvePlay('online', false);
	}

	async function runDownload() {
		if (polling) {
			pushTimeline('warn', 'Download already polling');
			return;
		}
		polling = true;
		try {
			const startedRes = await startPullerGameDownload(selectedId);
			showJson('Download started', startedRes);
			const final = await pollPullerDownloadUntilDone(selectedId, (p) => {
				progress = p;
			});
			progress = final;
			showJson('Download finished', final);
			if (final.state === 'done') {
				pushTimeline('success', 'Mirror ready', final.message);
			} else if (final.state === 'cancelled') {
				pushTimeline('warn', 'Download cancelled', final.message);
			} else {
				pushTimeline('error', 'Download failed', final.error ?? final.message);
			}
			dispatchOfflineStatusChanged(selectedId, 'download-done');
			await refreshStatuses();
		} catch (err) {
			pushTimeline('error', 'Download error', err instanceof Error ? err.message : String(err));
		} finally {
			polling = false;
		}
	}

	async function verifyOffline() {
		const status = await fetchPullerGameOfflineStatus(selectedId, true);
		showJson('Status', status);
		const base = getPullerBaseUrl();
		const entryUrl = `${base}/games/${encodeURIComponent(selectedId)}/offline/index.html`;
		try {
			const res = await fetch(entryUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
			const len = Number(res.headers.get('content-length') ?? 0);
			const ok = res.ok && (len === 0 || len >= 64);
			pushTimeline(
				ok ? 'success' : 'warn',
				'Offline entry check',
				`http=${res.status} bytes≈${len || '?'} offline=${status?.offline ?? false} url=${entryUrl}`
			);
		} catch (err) {
			pushTimeline(
				'error',
				'Offline entry fetch failed',
				err instanceof Error ? err.message : String(err)
			);
		}
	}

	async function executePullerCommand(name: PullerCommandName) {
		switch (name) {
			case 'health': {
				const health = await fetchPullerHealth();
				showJson('Health', health);
				pushTimeline(health?.ok ? 'success' : 'error', 'Health probe', getPullerBaseUrl());
				return;
			}
			case 'jobs': {
				const jobs = await fetchPullerJobs();
				showJson('Jobs', jobs);
				return;
			}
			case 'status': {
				const status = await fetchPullerGameOfflineStatus(selectedId, true);
				showJson('Status', status);
				await refreshStatuses();
				return;
			}
			case 'download': {
				await runDownload();
				return;
			}
			case 'progress': {
				const p = await fetchPullerDownloadProgress(selectedId);
				progress = p;
				showJson('Progress', p);
				return;
			}
			case 'cancel': {
				const result = await cancelPullerGameDownload(selectedId, true);
				showJson('Cancel', result);
				dispatchOfflineStatusChanged(selectedId, 'download-cancel');
				await refreshStatuses();
				return;
			}
			case 'delete': {
				await deletePullerOfflineCopy(selectedId);
				pushTimeline('success', 'Deleted offline copy');
				dispatchOfflineStatusChanged(selectedId, 'delete');
				await refreshStatuses();
				return;
			}
			case 'verify': {
				await verifyOffline();
				return;
			}
			case 'playOnline': {
				await resolvePlay('online', true);
				return;
			}
			case 'playOffline': {
				await resolvePlay('offline', true);
				return;
			}
		}
	}

	async function runPullerCommand(raw: string) {
		const parsed = parsePullerCommand(raw);
		if ('error' in parsed) {
			pushTimeline('error', 'Parse error', parsed.error);
			return;
		}
		try {
			await executePullerCommand(parsed.name);
		} catch (err) {
			pushTimeline(
				'error',
				`${parsed.name} failed`,
				err instanceof Error ? err.message : String(err)
			);
		}
	}

	onMount(() => {
		void refreshStatuses();
		void resolvePlay('online', false);
		const id = window.setInterval(() => void refreshStatuses(), 4000);
		return () => window.clearInterval(id);
	});

	const selectedStatus = $derived(statuses[selectedId] ?? null);
	const progressValue = $derived(Math.max(0, Math.min(100, progress?.progress ?? 0)));
	const snapshotLines = $derived([
		`harness=puller-test`,
		`game=${selectedId}`,
		`base=${getPullerBaseUrl()}`,
		`offline=${selectedStatus?.offline ?? false}`,
		`downloading=${selectedStatus?.downloading ?? false}`,
		`progress=${progress ? `${progress.state} ${Math.round(progress.progress)}%` : 'n/a'}`,
		`url=${playerUrl || '(none)'}`
	]);
</script>

<svelte:head>
	<title>Puller Test (dev)</title>
</svelte:head>

<div class="flex min-h-screen flex-col gap-4 p-4 lg:p-6">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<div class="flex items-center gap-2">
				<h1 class="text-xl font-semibold tracking-tight">Puller Test</h1>
				<Badge variant="secondary">dev</Badge>
			</div>
			<p class="max-w-2xl text-sm text-muted-foreground">
				Puller health, download lifecycle, proxy play, and mirror verification — no duplicated
				puller logic.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button type="button" size="sm" disabled={polling} onclick={() => void runDownload()}>
				{polling ? 'Downloading…' : 'Download'}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="outline"
				onclick={() => void runPullerCommand('cancel')}
			>
				Cancel
			</Button>
			<Button
				type="button"
				size="sm"
				variant="outline"
				onclick={() => void runPullerCommand('verify')}
			>
				Verify
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

			{#if progress}
				<Card.Root>
					<Card.Header class="pb-2">
						<Card.Title class="text-base">Progress</Card.Title>
						<Card.Description>
							{progress.state} · {Math.round(progress.progress || 0)}%
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-2">
						<Progress value={progressValue} />
						<p class="text-xs text-muted-foreground">{progress.message}</p>
						{#if progress.error}
							<p class="text-xs text-destructive">{progress.error}</p>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			<CommandPanel
				placeholder="download · health · playOnline"
				{helpLines}
				{presets}
				onSubmit={runPullerCommand}
			/>

			<LogExportBar
				gameId={selectedId}
				{snapshotLines}
				{timeline}
				filename={`puller-test-${selectedId}.txt`}
			/>
		</aside>

		<section class="flex min-h-0 flex-col gap-3">
			<Card.Root class="overflow-hidden p-0">
				<div class="relative h-[min(52vh,480px)] w-full bg-black">
					{#if playerUrl}
						{#key frameKey}
							<LazyGameFrame
								gameUrl={playerUrl}
								gameId={selectedId}
								{title}
								{posterUrl}
								fillContainer
								bind:started
							/>
						{/key}
					{:else}
						<div
							class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
						>
							{resolving
								? 'Resolving play URL…'
								: 'Select a game, then press Play or run playOnline / playOffline.'}
						</div>
					{/if}
				</div>
			</Card.Root>

			{#if lastJson}
				<Card.Root>
					<Card.Header class="pb-2">
						<Card.Title class="text-base">Last API payload</Card.Title>
					</Card.Header>
					<Card.Content>
						<pre
							class="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground"
						>{lastJson}</pre>
					</Card.Content>
				</Card.Root>
			{/if}
		</section>

		<aside class="flex min-h-[280px] flex-col xl:min-h-0">
			<TimelinePanel entries={timeline} />
		</aside>
	</div>
</div>
