<script lang="ts">
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
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
	let loading = $state(true);

	async function refresh(force = false) {
		loading = true;
		availability = await getGameAvailability(gameId, metadata, force);
		playMode = getGamePlayMode(gameId);

		if (playMode === 'offline' && !availability.offline && availability.online) {
			playMode = 'online';
			saveGamePlayMode(gameId, 'online');
		} else if (playMode === 'online' && !availability.online && availability.offline) {
			playMode = 'offline';
			saveGamePlayMode(gameId, 'offline');
		}
		loading = false;
	}

	function shouldRefreshForEvent(detail: OfflineStatusChangedDetail | undefined): boolean {
		if (!detail?.gameId) return true;
		return detail.gameId === gameId;
	}

	onMount(() => {
		void refresh();

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
		gameId;
		metadata;
		void refresh();
	});

	function setPlayMode(mode: GamePlayMode) {
		if (mode !== 'online' && mode !== 'offline') return;
		playMode = mode;
		saveGamePlayMode(gameId, mode);
		onPlayUrlChange?.();
	}

	let hasBoth = $derived(availability.online && availability.offline);
	let onlyOnline = $derived(availability.online && !availability.offline);
	let onlyOffline = $derived(!availability.online && availability.offline);
</script>

{#if !loading && (availability.online || availability.offline)}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<span class="text-sm font-medium">Play from</span>

		{#if hasBoth}
			<ToggleGroup.Root
				type="single"
				value={playMode}
				onValueChange={(v) => {
					if (v === 'online' || v === 'offline') setPlayMode(v);
				}}
				class="justify-start"
			>
				<ToggleGroup.Item value="online" aria-label="Play online" class="gap-1.5">
					<Wifi class="h-4 w-4" />
					Online
				</ToggleGroup.Item>
				<ToggleGroup.Item value="offline" aria-label="Play offline" class="gap-1.5">
					<HardDrive class="h-4 w-4" />
					Offline
				</ToggleGroup.Item>
			</ToggleGroup.Root>
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
