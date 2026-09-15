<script lang="ts">
	import { onMount, tick } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import {
		ChevronRight,
		ChevronLeft,
		MoreVertical,
		Shield,
		Volume2,
		Gamepad2,
		BarChart3,
		Smartphone,
		Download
	} from 'lucide-svelte';
	import {
		Root as DropdownMenuRoot,
		Trigger as DropdownMenuTrigger,
		Content as DropdownMenuContent,
		Item as DropdownMenuItem
	} from '$lib/components/ui/dropdown-menu';
	import {
		isPrivacyEnabled,
		enablePrivacyMode,
		disablePrivacyMode,
		changePrivacyPassword,
		getPrivacyLockDelayMs,
		getPrivacyDisguiseMode,
		getPrivacyDisguiseProvider,
		getPrivacyDisguiseServiceId,
		savePrivacyDisguiseMode,
		savePrivacyDisguiseSelection,
		savePrivacyLockDelayMs,
		MAX_PRIVACY_LOCK_DELAY_MS,
		getPrivacyPauseGameWhileLocked,
		savePrivacyPauseGameWhileLocked,
		getPrivacyLockShortcut,
		savePrivacyLockShortcut,
		conflictsWithSettingsShortcut,
		isModifierOnlyKeyboardCode,
		type PrivacyLockShortcut
	} from '$lib/utils/privacy-mode';
	import type { PrivacyDisguiseMode, PrivacyDisguiseProvider } from '$lib/utils/site-settings';
	import {
		getMuteAudioScope,
		getMasterVolume,
		saveMuteAudioScope,
		saveMasterVolume,
		type MuteAudioScope
	} from '$lib/utils/audio-mute';
	import { cn } from '$lib/utils.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { computeGlobalSearchResults } from '$lib/components/settings/search';
	import SettingsSearchAccordion from '$lib/components/settings/search/SettingsSearchAccordion.svelte';
	import PrivacyModeSection from '$lib/components/settings/sections/privacy-mode/PrivacyModeSection.svelte';
	import AudioSection from '$lib/components/settings/sections/audio/AudioSection.svelte';
	import AnalyticsSection from '$lib/components/settings/sections/analytics/AnalyticsSection.svelte';
	import GamesSection from '$lib/components/settings/sections/games/GamesSection.svelte';
	import TouchControlsSection from '$lib/components/settings/sections/touch-controls/TouchControlsSection.svelte';
	import UpdatesSection from '$lib/components/settings/sections/updates/UpdatesSection.svelte';
	import { isTauriAndroidBuild } from '$lib/utils/offline-deployment';
	import {
		clearCategoryAffinities,
		getCategoryAffinityMap,
		getPlayLimits,
		setCategoryAffinity,
		setPlayLimits
	} from '$lib/utils/play-recommendations';
	import { getDefaultGamePlayMode, type GamePlayMode } from '$lib/utils/game-play-mode';
	import {
		DEFAULT_TOUCH_SETTINGS,
		loadTouchConsoleSettings,
		saveTouchConsoleSettings,
		type TouchConsoleSettings
	} from '$lib/utils/touch-console';
	import { browser } from '$app/environment';

	type Panel = 'root' | 'privacy' | 'audio' | 'analytics' | 'games' | 'touch' | 'updates';
	const showAndroidUpdates = isTauriAndroidBuild();

	let {
		open = $bindable(false),
		onApplied
	}: {
		open?: boolean;
		onApplied?: () => void;
	} = $props();

	let panel = $state<Panel>('root');
	let actualEnabled = $state(false);
	let newPassword = $state('');
	let enableDialogOpen = $state(false);
	let disableConfirmOpen = $state(false);
	let settingsSearchQuery = $state('');
	let currentPassword = $state('');
	let changeCurrent = $state('');
	let changeNew = $state('');
	let changeConfirm = $state('');
	let message = $state('');
	let error = $state('');
	let busy = $state(false);

	let providerChoice = $state<PrivacyDisguiseProvider>('google');
	let serviceChoice = $state('docs');
	let disguiseChoice = $state<PrivacyDisguiseMode>('focus_loss');
	let lockDelayStr = $state('0');
	let rootPrivacySwitch = $state(false);
	let muteScopeChoice = $state<MuteAudioScope>('off');
	let pauseGameWhileLocked = $state(false);
	let lockShortcutDraft = $state<PrivacyLockShortcut | null>(null);
	let recordingLockShortcut = $state(false);
	let volumeSliderPct = $state(100);
	let searchAccordionOpen = $state<string[]>([]);
	let analyticsLimitEnabled = $state(false);
	let analyticsLimitMinutes = $state(0);
	let analyticsAffinity = $state<Record<string, number>>({});
	let analyticsPanelKey = $state(0);
	let gamesDefaultPlayMode = $state<GamePlayMode>('online');
	let touchSettingsDraft = $state<TouchConsoleSettings>(structuredClone(DEFAULT_TOUCH_SETTINGS));

	type SettingsBaseline = {
		disguise: PrivacyDisguiseMode;
		provider: PrivacyDisguiseProvider;
		service: string;
		lockDelayStr: string;
		pauseGame: boolean;
		lockShortcut: PrivacyLockShortcut | null;
		muteScope: MuteAudioScope;
		volumePct: number;
		analyticsLimitEnabled: boolean;
		analyticsLimitMin: number;
		analyticsAffinityJson: string;
		touchSettingsJson: string;
	};

	function stableAffinityJson(a: Record<string, number>): string {
		return JSON.stringify(
			Object.keys(a)
				.sort()
				.map((k) => [k, a[k] ?? 0])
		);
	}

	let baseline = $state<SettingsBaseline>({
		disguise: 'focus_loss',
		provider: 'google',
		service: 'docs',
		lockDelayStr: '0',
		pauseGame: false,
		lockShortcut: null,
		muteScope: 'off',
		volumePct: 100,
		analyticsLimitEnabled: false,
		analyticsLimitMin: 0,
		analyticsAffinityJson: '[]',
		touchSettingsJson: JSON.stringify(DEFAULT_TOUCH_SETTINGS)
	});

	onMount(() => {
		if (!browser) return;
		const loaded = loadTouchConsoleSettings();
		touchSettingsDraft = loaded;
		baseline = { ...baseline, touchSettingsJson: JSON.stringify(loaded) };
	});

	const globalSearchResults = $derived.by(() => {
		const results = computeGlobalSearchResults(settingsSearchQuery);
		if (showAndroidUpdates) return results;
		return results.filter((r) => r.panel !== 'updates');
	});

	$effect(() => {
		const next = globalSearchResults.map((x) => x.id);
		const prev = searchAccordionOpen;
		if (prev.length === next.length && prev.every((id, i) => id === next[i])) return;
		searchAccordionOpen = next;
	});

	$effect(() => {
		if (!recordingLockShortcut) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingLockShortcut = false;
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			const next: PrivacyLockShortcut = {
				code: e.code,
				ctrlKey: e.ctrlKey,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				metaKey: e.metaKey
			};
			if (conflictsWithSettingsShortcut(next)) {
				error = 'That shortcut is reserved for opening settings (Ctrl+Shift+,).';
				recordingLockShortcut = false;
				return;
			}
			lockShortcutDraft = next;
			recordingLockShortcut = false;
			error = '';
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	async function goToSearchSubsection(
		targetPanel: 'privacy' | 'audio' | 'analytics' | 'games' | 'touch' | 'updates',
		scrollTargetId: string
	) {
		if (targetPanel === 'privacy' && !actualEnabled) {
			settingsSearchQuery = '';
			enableDialogOpen = true;
			return;
		}
		if (targetPanel === 'updates' && !showAndroidUpdates) {
			settingsSearchQuery = '';
			return;
		}
		settingsSearchQuery = '';
		panel = targetPanel;
		syncLocal();
		await tick();
		await tick();
		requestAnimationFrame(() => {
			document
				.getElementById(scrollTargetId)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
	}

	const pendingChangesCount = $derived.by(() => {
		if (panel === 'root') return 0;
		if (panel === 'analytics') {
			let n = 0;
			if (analyticsLimitEnabled !== baseline.analyticsLimitEnabled) n++;
			if (analyticsLimitMinutes !== baseline.analyticsLimitMin) n++;
			if (stableAffinityJson(analyticsAffinity) !== baseline.analyticsAffinityJson) n++;
			return n;
		}
		const vol = Number(volumeSliderPct);
		let n = 0;
		if (disguiseChoice !== baseline.disguise) n++;
		if (providerChoice !== baseline.provider) n++;
		if (serviceChoice !== baseline.service) n++;
		if (lockDelayStr !== baseline.lockDelayStr) n++;
		if (pauseGameWhileLocked !== baseline.pauseGame) n++;
		if (JSON.stringify(lockShortcutDraft) !== JSON.stringify(baseline.lockShortcut)) n++;
		if (muteScopeChoice !== baseline.muteScope) n++;
		if (vol !== baseline.volumePct) n++;
		if (JSON.stringify(touchSettingsDraft) !== baseline.touchSettingsJson) n++;
		return n;
	});

	function captureBaseline() {
		baseline = {
			disguise: disguiseChoice,
			provider: providerChoice,
			service: serviceChoice,
			lockDelayStr: lockDelayStr,
			pauseGame: pauseGameWhileLocked,
			lockShortcut: lockShortcutDraft ? { ...lockShortcutDraft } : null,
			muteScope: muteScopeChoice,
			volumePct: Number(volumeSliderPct),
			analyticsLimitEnabled,
			analyticsLimitMin: analyticsLimitMinutes,
			analyticsAffinityJson: stableAffinityJson(analyticsAffinity),
			touchSettingsJson: JSON.stringify(touchSettingsDraft)
		};
	}

	function saveAllSettings() {
		error = '';
		if (panel === 'root' || pendingChangesCount === 0) return;

		if (panel === 'analytics') {
			const limitChanged =
				analyticsLimitEnabled !== baseline.analyticsLimitEnabled ||
				analyticsLimitMinutes !== baseline.analyticsLimitMin;
			const affinityChanged =
				stableAffinityJson(analyticsAffinity) !== baseline.analyticsAffinityJson;

			if (
				limitChanged &&
				analyticsLimitEnabled &&
				(!Number.isFinite(analyticsLimitMinutes) || analyticsLimitMinutes < 1)
			) {
				error = 'Set a daily limit of at least 1 minute, or turn the limit off.';
				return;
			}

			if (limitChanged) {
				if (analyticsLimitEnabled) {
					setPlayLimits({ dailyGlobalLimitMs: Math.round(analyticsLimitMinutes) * 60_000 });
				} else {
					setPlayLimits({ dailyGlobalLimitMs: 0 });
				}
				if (typeof window !== 'undefined') {
					window.dispatchEvent(new CustomEvent('potato-tomato-play-limits-changed'));
				}
			}
			if (affinityChanged) {
				clearCategoryAffinities();
				for (const [k, v] of Object.entries(analyticsAffinity)) {
					setCategoryAffinity(k, v);
				}
			}
			captureBaseline();
			message = 'Settings saved.';
			onApplied?.();
			return;
		}

		if (disguiseChoice !== baseline.disguise) {
			savePrivacyDisguiseMode(disguiseChoice);
		}
		if (providerChoice !== baseline.provider || serviceChoice !== baseline.service) {
			if (!savePrivacyDisguiseSelection(providerChoice, serviceChoice)) {
				error = 'Choose a valid service.';
				return;
			}
		}
		if (lockDelayStr !== baseline.lockDelayStr) {
			const sec = Math.max(
				0,
				Math.min(parseInt(lockDelayStr, 10) || 0, MAX_PRIVACY_LOCK_DELAY_MS / 1000)
			);
			lockDelayStr = String(sec);
			savePrivacyLockDelayMs(sec * 1000);
		}
		if (pauseGameWhileLocked !== baseline.pauseGame) {
			savePrivacyPauseGameWhileLocked(pauseGameWhileLocked);
		}
		if (JSON.stringify(lockShortcutDraft) !== JSON.stringify(baseline.lockShortcut)) {
			savePrivacyLockShortcut(lockShortcutDraft);
		}
		if (muteScopeChoice !== baseline.muteScope) {
			saveMuteAudioScope(muteScopeChoice);
		}
		if (Number(volumeSliderPct) !== baseline.volumePct) {
			saveMasterVolume(Number(volumeSliderPct) / 100);
		}
		if (JSON.stringify(touchSettingsDraft) !== baseline.touchSettingsJson) {
			saveTouchConsoleSettings(touchSettingsDraft);
		}

		captureBaseline();
		message = 'Settings saved.';
		onApplied?.();
	}

	function shouldShowMessage(m: string): boolean {
		const t = m.trim().toLowerCase();
		if (t.includes('privacy mode is on') || t.includes('privacy mode is off')) return false;
		return m.length > 0;
	}

	function discardPendingChanges() {
		if (panel === 'root') return;
		if (panel === 'analytics') {
			analyticsPanelKey += 1;
		}
		syncLocal();
		message = '';
		error = '';
	}

	const inputClass =
		'bg-background text-foreground border-input placeholder:text-muted-foreground focus-visible:ring-ring/50';

	const searchInputClass =
		'h-7 w-[min(11rem,36vw)] shrink-0 rounded-md border border-transparent bg-muted/40 px-2 py-0.5 text-xs text-foreground/90 placeholder:text-muted-foreground/80 outline-none transition-colors focus-visible:border-border focus-visible:bg-background';

	const LOCK_DELAY_OPTIONS = [
		{ label: 'Immediately', value: 0 },
		{ label: '3 seconds', value: 3 },
		{ label: '5 seconds', value: 5 },
		{ label: '10 seconds', value: 10 },
		{ label: '30 seconds', value: 30 },
		{ label: '1 minute', value: 60 },
		{ label: '2 minutes', value: 120 }
	] as const;

	function nearestLockDelaySec(sec: number): string {
		const opts = LOCK_DELAY_OPTIONS.map((o) => o.value);
		const nearest = opts.reduce((best, v) => (Math.abs(v - sec) < Math.abs(best - sec) ? v : best));
		return String(nearest);
	}

	function syncLocal() {
		const enabled = isPrivacyEnabled();
		actualEnabled = enabled;
		rootPrivacySwitch = enabled;
		const ms = getPrivacyLockDelayMs();
		lockDelayStr = nearestLockDelaySec(Math.round(ms / 1000));
		providerChoice = getPrivacyDisguiseProvider();
		serviceChoice = getPrivacyDisguiseServiceId();
		disguiseChoice = getPrivacyDisguiseMode();
		muteScopeChoice = getMuteAudioScope();
		volumeSliderPct = Math.round(getMasterVolume() * 100);
		pauseGameWhileLocked = getPrivacyPauseGameWhileLocked();
		lockShortcutDraft = getPrivacyLockShortcut();
		const limits = getPlayLimits();
		analyticsLimitEnabled = limits.dailyGlobalLimitMs > 0;
		analyticsLimitMinutes =
			limits.dailyGlobalLimitMs > 0 ? Math.round(limits.dailyGlobalLimitMs / 60000) : 0;
		analyticsAffinity = { ...getCategoryAffinityMap() };
		gamesDefaultPlayMode = getDefaultGamePlayMode();
		touchSettingsDraft = loadTouchConsoleSettings();
		if (panel !== 'analytics') {
			captureBaseline();
		}
	}

	function goBack() {
		panel = 'root';
		syncLocal();
		message = '';
		error = '';
	}

	function openPrivacyEntry() {
		if (!actualEnabled) {
			error = '';
			message = '';
			newPassword = '';
			enableDialogOpen = true;
			return;
		}
		panel = 'privacy';
	}

	function performDisablePrivacy() {
		disablePrivacyMode();
		actualEnabled = false;
		rootPrivacySwitch = false;
		currentPassword = '';
		error = '';
		disableConfirmOpen = false;
		syncLocal();
		onApplied?.();
		panel = 'root';
	}

	let settingsDialogEntered = $state(false);

	$effect(() => {
		if (!open) {
			settingsDialogEntered = false;
			enableDialogOpen = false;
			disableConfirmOpen = false;
			recordingLockShortcut = false;
			return;
		}
		if (settingsDialogEntered) return;
		settingsDialogEntered = true;
		syncLocal();
		panel = 'root';
		newPassword = '';
		currentPassword = '';
		changeCurrent = '';
		changeNew = '';
		changeConfirm = '';
		message = '';
		error = '';
		settingsSearchQuery = '';
		enableDialogOpen = false;
		disableConfirmOpen = false;
	});

	function handleRootPrivacySwitch(checked: boolean) {
		if (checked && !actualEnabled) {
			queueMicrotask(() => {
				rootPrivacySwitch = false;
			});
			error = '';
			message = '';
			newPassword = '';
			enableDialogOpen = true;
			return;
		}
		if (!checked && actualEnabled) {
			queueMicrotask(() => {
				rootPrivacySwitch = true;
			});
			disableConfirmOpen = true;
		}
	}

	async function submitEnablePrivacy() {
		error = '';
		message = '';
		if (newPassword.length < 4) {
			error = 'Choose a password of at least 4 characters.';
			return;
		}
		busy = true;
		try {
			await enablePrivacyMode(newPassword);
			actualEnabled = true;
			rootPrivacySwitch = true;
			savePrivacyDisguiseSelection(providerChoice, serviceChoice);
			savePrivacyLockDelayMs((parseInt(lockDelayStr, 10) || 0) * 1000);
			savePrivacyDisguiseMode(disguiseChoice);
			savePrivacyLockShortcut(lockShortcutDraft);
			saveMuteAudioScope(muteScopeChoice);
			saveMasterVolume(volumeSliderPct / 100);
			newPassword = '';
			enableDialogOpen = false;
			panel = 'privacy';
			captureBaseline();
			onApplied?.();
		} catch {
			error = 'Could not enable privacy mode.';
		} finally {
			busy = false;
		}
	}

	async function submitChangePassword(e: Event) {
		e.preventDefault();
		error = '';
		message = '';
		if (changeNew.length < 4) {
			error = 'New password must be at least 4 characters.';
			return;
		}
		if (changeNew !== changeConfirm) {
			error = 'New passwords do not match.';
			return;
		}
		busy = true;
		try {
			const ok = await changePrivacyPassword(changeCurrent, changeNew);
			if (!ok) {
				error = 'Current password is incorrect.';
				return;
			}
			changeCurrent = '';
			changeNew = '';
			changeConfirm = '';
			message = 'Password updated.';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet saveSplitToolbar()}
	<div class="inline-flex shrink-0 items-stretch overflow-hidden rounded-md shadow-xs">
		<Button
			type="button"
			class="gap-1.5 rounded-r-none pr-3"
			disabled={busy || pendingChangesCount === 0}
			onclick={saveAllSettings}
		>
			Save
			{#if pendingChangesCount > 0}
				<span
					class="inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primary-foreground/25 px-1.5 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums"
					aria-label={`${pendingChangesCount} unsaved changes`}
				>
					{pendingChangesCount}
				</span>
			{/if}
		</Button>
		<DropdownMenuRoot>
			<DropdownMenuTrigger
				class={cn(
					buttonVariants({ variant: 'default', size: 'default' }),
					'rounded-l-none rounded-r-md border-l border-primary-foreground/25 px-2.5'
				)}
				disabled={busy}
				aria-label="More save options"
			>
				<MoreVertical class="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" class="w-40">
				<DropdownMenuItem
					disabled={busy || pendingChangesCount === 0}
					onclick={() => discardPendingChanges()}
				>
					Discard
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenuRoot>
	</div>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content
		class={`flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 ${
			panel === 'touch' ? 'sm:max-w-5xl' : 'sm:max-w-md'
		}`}
	>
		{#if panel === 'root'}
			<div class="border-b px-6 pt-6 pb-3">
				<Dialog.Title class="shrink-0">Settings</Dialog.Title>
			</div>
			<div class="flex flex-wrap items-center gap-2 border-b px-6 pb-3">
				<input
					type="search"
					bind:value={settingsSearchQuery}
					placeholder="Search…"
					class="{searchInputClass} min-w-0 flex-1 basis-[min(100%,12rem)]"
					aria-label="Search settings"
					autocomplete="off"
				/>
			</div>

			<!--
				min-h-0 is load-bearing: a flex child defaults to min-height:auto and
				refuses to shrink below its content, so without it this div stays full
				height, Dialog.Content's overflow-hidden clips the overflow, and the
				rows past the fold are unreachable on a phone with nothing scrolling.
			-->
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
				{#if settingsSearchQuery.trim()}
					{#if globalSearchResults.length === 0}
						<p class="px-4 py-6 text-center text-xs text-muted-foreground">
							No settings match your search.
						</p>
					{:else}
						<SettingsSearchAccordion
							results={globalSearchResults}
							bind:accordionOpen={searchAccordionOpen}
							onPickSubsection={(p, id) => void goToSearchSubsection(p, id)}
						/>
					{/if}
				{:else}
					<div class="divide-y divide-border overflow-hidden rounded-lg border bg-card">
						<div class="flex items-stretch" role="group" aria-label="Privacy mode">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
								onclick={openPrivacyEntry}
							>
								<Shield class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">Privacy mode</p>
									<p class="text-xs text-muted-foreground">Tab disguise, lock timing, passcode</p>
								</div>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
							<div
								class="flex shrink-0 items-center px-3"
								role="presentation"
								onclick={(e) => e.stopPropagation()}
							>
								<Switch
									bind:checked={rootPrivacySwitch}
									onCheckedChange={handleRootPrivacySwitch}
									disabled={busy}
									aria-label="Turn privacy mode on or off"
								/>
							</div>
						</div>

						<button
							type="button"
							class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => {
								panel = 'audio';
							}}
						>
							<Volume2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">Audio</p>
								<p class="text-xs text-muted-foreground">Mute scope, volume, and playback</p>
							</div>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</button>

						<button
							type="button"
							class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => {
								panel = 'games';
								syncLocal();
							}}
						>
							<Gamepad2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">Games</p>
								<p class="text-xs text-muted-foreground">Online vs offline defaults</p>
							</div>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</button>

						<button
							type="button"
							class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => {
								panel = 'touch';
								syncLocal();
							}}
						>
							<Smartphone class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">Touch Controls</p>
								<p class="text-xs text-muted-foreground">
									On-screen joystick, layout, and key mapping
								</p>
							</div>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</button>

						{#if showAndroidUpdates}
							<button
								type="button"
								class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
								onclick={() => {
									panel = 'updates';
								}}
							>
								<Download class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium">Updates</p>
									<p class="text-xs text-muted-foreground">Download the latest Android APK</p>
								</div>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						{/if}

						<button
							type="button"
							class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => {
								panel = 'analytics';
								syncLocal();
							}}
						>
							<BarChart3 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">Analytics</p>
								<p class="text-xs text-muted-foreground">
									Playtime limits and recommendation taste
								</p>
							</div>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</button>
					</div>
				{/if}
			</div>

			<div class="border-t px-6 py-4">
				{#if shouldShowMessage(message)}
					<p class="text-sm text-muted-foreground">{message}</p>
				{/if}
				{#if error}
					<p class="text-sm text-destructive">{error}</p>
				{/if}
			</div>
		{:else if panel === 'privacy'}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Privacy mode</h2>
					<p class="sr-only">Configure privacy mode options</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search privacy settings"
						autocomplete="off"
					/>
					{@render saveSplitToolbar()}
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
				<PrivacyModeSection
					searchQuery={settingsSearchQuery}
					{busy}
					bind:disguiseChoice
					bind:providerChoice
					bind:serviceChoice
					bind:lockDelayStr
					bind:pauseGameWhileLocked
					bind:lockShortcutDraft
					bind:recordingLockShortcut
					bind:changeCurrent
					bind:changeNew
					bind:changeConfirm
					{message}
					{error}
					{inputClass}
					onStartRecordingShortcut={() => {
						error = '';
						recordingLockShortcut = true;
					}}
					onShortcutClearError={() => {
						error = '';
					}}
					onRequestDisablePrivacy={() => {
						disableConfirmOpen = true;
					}}
					onSubmitChangePassword={submitChangePassword}
				/>
			</div>
		{:else if panel === 'audio'}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Audio</h2>
					<p class="sr-only">Audio and playback settings</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search audio settings"
						autocomplete="off"
					/>
					{@render saveSplitToolbar()}
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
				<AudioSection
					searchQuery={settingsSearchQuery}
					{busy}
					bind:muteScopeChoice
					bind:volumeSliderPct
					{message}
					{error}
				/>
			</div>
		{:else if panel === 'analytics'}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Analytics</h2>
					<p class="sr-only">Playtime and recommendation settings</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search analytics settings"
						autocomplete="off"
					/>
					{@render saveSplitToolbar()}
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
				{#key analyticsPanelKey}
					<AnalyticsSection
						searchQuery={settingsSearchQuery}
						{busy}
						bind:limitEnabled={analyticsLimitEnabled}
						bind:limitMinutes={analyticsLimitMinutes}
						bind:affinity={analyticsAffinity}
						{message}
						{error}
						onReady={() => captureBaseline()}
					/>
				{/key}
			</div>
		{:else if panel === 'games'}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Games</h2>
					<p class="sr-only">Play source and offline defaults</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search games settings"
						autocomplete="off"
					/>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
				<GamesSection
					searchQuery={settingsSearchQuery}
					{busy}
					bind:defaultPlayMode={gamesDefaultPlayMode}
				/>
			</div>
		{:else if panel === 'touch'}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Touch Controls</h2>
					<p class="sr-only">On-screen joystick layout and key mapping</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search touch control settings"
						autocomplete="off"
					/>
					{@render saveSplitToolbar()}
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
				<TouchControlsSection
					searchQuery={settingsSearchQuery}
					{busy}
					bind:settings={touchSettingsDraft}
				/>
			</div>
		{:else if panel === 'updates' && showAndroidUpdates}
			<div class="flex flex-wrap items-center gap-2 border-b px-2 py-3 pe-12">
				<Button
					variant="ghost"
					size="icon"
					class="shrink-0"
					onclick={goBack}
					aria-label="Back to settings"
				>
					<ChevronLeft class="size-5" />
				</Button>
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-[min(100%,10rem)]">
					<h2 class="text-lg leading-none font-semibold tracking-tight">Updates</h2>
					<p class="sr-only">Download the latest Android APK</p>
				</div>
				<div
					class="flex w-full min-w-0 flex-[1_1_14rem] flex-wrap items-center justify-end gap-2 sm:ms-auto sm:w-auto"
				>
					<input
						type="search"
						bind:value={settingsSearchQuery}
						placeholder="Search…"
						class="{searchInputClass} min-w-0 flex-1"
						aria-label="Search update settings"
						autocomplete="off"
					/>
				</div>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
				<UpdatesSection searchQuery={settingsSearchQuery} {busy} />
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	bind:open={enableDialogOpen}
	onOpenChange={(o) => {
		if (!o) {
			newPassword = '';
			error = '';
		}
	}}
>
	<Dialog.Content class="sm:max-w-md" showCloseButton={true}>
		<Dialog.Header>
			<Dialog.Title>Enable privacy mode</Dialog.Title>
			<Dialog.Description>
				Set a passcode to protect this site. You can adjust disguise and lock timing afterward.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2 py-2">
			<Label for="pm-enable-pw">Password</Label>
			<Input
				id="pm-enable-pw"
				type="password"
				bind:value={newPassword}
				autocomplete="new-password"
				class={inputClass}
				onkeydown={(e) => {
					if (e.key === 'Enter') void submitEnablePrivacy();
				}}
			/>
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</div>
		<Dialog.Footer class="gap-2 sm:gap-2">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					enableDialogOpen = false;
					newPassword = '';
					error = '';
				}}
			>
				Cancel
			</Button>
			<Button type="button" onclick={() => void submitEnablePrivacy()} disabled={busy}
				>Enable</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={disableConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Turn off privacy mode?</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure? This removes passcode protection for this site.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'destructive' }))}
				onclick={() => performDisablePrivacy()}
			>
				Turn off
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
