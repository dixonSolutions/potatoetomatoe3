<script lang="ts">
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { HardDrive, Wifi } from 'lucide-svelte';
	import { getGameAvailability } from '$lib/utils/game-availability';
	import {
		OFFLINE_STATUS_CHANGED,
		type OfflineStatusChangedDetail
	} from '$lib/utils/offline-downloader';
	import {
		getGamePlayMode,
		saveGamePlayMode,
		type GamePlayMode,
		GAME_PLAY_MODE_CHANGED,
		DEFAULT_GAME_PLAY_MODE_CHANGED
	} from '$lib/utils/game-play-mode';
	import type { GameMetadata } from '$lib/utils/games';
	import { onMount } from 'svelte';

	let {
		gameId,
		metadata = null,
		onPlayUrlChange
	}: {
		gameId: string;
		metadata?: GameMetadata | null;
		onPlayUrlChange?: () => void;
	} = $props();

	let availability = $state({ online: false, offline: false });
	let playMode = $state<GamePlayMode>('online');
	/** False only until the first successful availability probe (keeps controls mounted). */
	let ready = $state(false);
	/** Ignore stale async refresh results after the user picks a mode. */
	let refreshGeneration = 0;
	let activeGameId = $state('');

	async function refresh(force = false) {
		const id = gameId;
		const generation = ++refreshGeneration;
		const nextAvailability = await getGameAvailability(id, metadata, force);
		if (generation !== refreshGeneration || id !== gameId) return;

		availability = nextAvailability;
		let nextMode = getGamePlayMode(id);

		if (nextMode === 'offline' && !nextAvailability.offline && nextAvailability.online) {
			nextMode = 'online';
			saveGamePlayMode(id, 'online');
		} else if (nextMode === 'online' && !nextAvailability.online && nextAvailability.offline) {
			nextMode = 'offline';
			saveGamePlayMode(id, 'offline');
		}
		playMode = nextMode;
		ready = true;
	}

	function shouldRefreshForEvent(detail: OfflineStatusChangedDetail | undefined): boolean {
		if (!detail?.gameId) return true;
		return detail.gameId === gameId;
	}

	onMount(() => {
		const onModeChange = (e: Event) => {
			const d = (e as CustomEvent<{ gameId?: string; mode: GamePlayMode }>).detail;
			if (d?.gameId && d.gameId !== gameId) return;
			if (d?.gameId === gameId) playMode = d.mode;
			else if (!d?.gameId) playMode = getGamePlayMode(gameId);
		};
		const onOfflineStatusChanged = (e: Event) => {
			const detail = (e as CustomEvent<OfflineStatusChangedDetail>).detail;
			if (!shouldRefreshForEvent(detail)) return;
			void refresh(true);
			if (detail?.reason === 'download-done' || detail?.reason === 'delete') {
				onPlayUrlChange?.();
			}
		};

		window.addEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
		window.addEventListener(DEFAULT_GAME_PLAY_MODE_CHANGED, onModeChange);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
			window.removeEventListener(DEFAULT_GAME_PLAY_MODE_CHANGED, onModeChange);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	$effect(() => {
		const id = gameId;
		metadata;
		if (id !== activeGameId) {
			activeGameId = id;
			ready = false;
			playMode = getGamePlayMode(id);
		}
		void refresh();
	});

	function setPlayMode(mode: GamePlayMode) {
		if (mode !== 'online' && mode !== 'offline') return;
		if (mode === playMode) return;
		refreshGeneration++;
		playMode = mode;
		saveGamePlayMode(gameId, mode);
		onPlayUrlChange?.();
	}

	let hasBoth = $derived(availability.online && availability.offline);
	let onlyOnline = $derived(availability.online && !availability.offline);
	let onlyOffline = $derived(!availability.online && availability.offline);
</script>

{#if ready && (availability.online || availability.offline)}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<span class="text-sm font-medium">Play from</span>

		{#if hasBoth}
			<div
				class="inline-flex items-center rounded-md border bg-muted/40 p-0.5"
				role="group"
				aria-label="Play from online or offline copy"
			>
				<Button
					type="button"
					size="sm"
					variant={playMode === 'online' ? 'default' : 'ghost'}
					class="h-8 gap-1.5 rounded-sm px-3"
					aria-pressed={playMode === 'online'}
					onclick={() => setPlayMode('online')}
				>
					<Wifi class="h-4 w-4" />
					Online
				</Button>
				<Button
					type="button"
					size="sm"
					variant={playMode === 'offline' ? 'default' : 'ghost'}
					class="h-8 gap-1.5 rounded-sm px-3"
					aria-pressed={playMode === 'offline'}
					onclick={() => setPlayMode('offline')}
				>
					<HardDrive class="h-4 w-4" />
					Offline
				</Button>
			</div>
		{:else if onlyOnline}
			<Badge variant="outline" class="gap-1">
				<Wifi class="h-3 w-3" />
				Online only
			</Badge>
		{:else if onlyOffline}
			<Badge variant="outline" class="gap-1">
				<HardDrive class="h-3 w-3" />
				Offline only
			</Badge>
		{/if}

		{#if metadata?.engine === 'unity' && playMode === 'online'}
			<Badge variant="secondary" class="text-[11px]">Unity · CDN</Badge>
		{/if}
	</div>
{/if}
