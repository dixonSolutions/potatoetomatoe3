<script lang="ts">
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { ChevronLeft, ChevronRight, Search } from 'lucide-svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Dialog from '$lib/components/ui/dialog';
	import Button from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils.js';
	import { computeGlobalSearchResults, groupSearchResultsBySection } from './search';
	import SettingsSearchResults from './search/SettingsSearchResults.svelte';
	import {
		SETTINGS_SECTIONS,
		getSettingsSection,
		isSettingsSectionAvailable,
		type SettingsSectionId
	} from './settings-sections';
	import { setSettingsShellContext, type SettingsSectionDraft } from './settings-section-context';
	import GamesSection from './sections/games/GamesSection.svelte';
	import ControlsSection from './sections/controls/ControlsSection.svelte';
	import SoundSection from './sections/sound/SoundSection.svelte';
	import PrivacySection from './sections/privacy/PrivacySection.svelte';
	import PlayTimeSection from './sections/play-time/PlayTimeSection.svelte';
	import AppSection from './sections/app/AppSection.svelte';

	/*
	 * The dialog chrome only: navigation, search, and the save bar. Each section loads,
	 * edits and saves its own settings, and hands the shell a draft when it has a Save.
	 */

	let {
		open = $bindable(false),
		onApplied
	}: {
		open?: boolean;
		onApplied?: () => void;
	} = $props();

	const sections = SETTINGS_SECTIONS.filter((s) => isSettingsSectionAvailable(s.id));

	/* From `sm` the list sits beside the section; on a phone they take turns. */
	const wide = new MediaQuery('min-width: 640px');

	let chosen = $state<SettingsSectionId | null>(null);
	const active = $derived<SettingsSectionId | null>(
		chosen ?? (wide.current ? sections[0].id : null)
	);
	const activeDef = $derived(active ? getSettingsSection(active) : null);

	let query = $state('');
	const searching = $derived(query.trim().length > 0);
	const resultGroups = $derived(
		groupSearchResultsBySection(computeGlobalSearchResults(query), isSettingsSectionAvailable)
	);
	const resultCount = $derived(resultGroups.reduce((n, g) => n + g.hits.length, 0));

	/* ---- The open section's unsaved edits ---- */

	let draft = $state.raw<SettingsSectionDraft | null>(null);
	/*
	 * Which draft is registered, kept outside reactivity. The outgoing section's teardown
	 * can run after the incoming one registered, and a read of `draft` there may still see
	 * the outgoing value while the switch is being applied, which cleared the new one.
	 */
	let registered: SettingsSectionDraft | null = null;
	const pending = $derived(draft?.pending ?? 0);
	let saving = $state(false);
	let saveError = $state('');
	let revealId = $state<string | null>(null);

	setSettingsShellContext({
		get revealId() {
			return revealId;
		},
		registerDraft(next) {
			registered = next;
			draft = next;
			saveError = '';
			return () => {
				if (registered !== next) return;
				registered = null;
				draft = null;
			};
		},
		applied: () => onApplied?.(),
		close: () => requestOpenChange(false)
	});

	async function saveDraft(): Promise<boolean> {
		if (!draft || draft.pending === 0) return true;
		saving = true;
		saveError = '';
		try {
			const problem = await draft.save();
			if (problem) {
				saveError = problem;
				return false;
			}
			toast.success('Settings saved');
			return true;
		} finally {
			saving = false;
		}
	}

	function discardDraft() {
		draft?.discard();
		saveError = '';
	}

	/* Leaving a section or closing with unsaved edits asks first, instead of dropping them. */
	let guardOpen = $state(false);
	let afterGuard: (() => void) | null = null;

	function guarded(action: () => void) {
		if (pending > 0) {
			afterGuard = action;
			guardOpen = true;
			return;
		}
		action();
	}

	function takeAfterGuard(): (() => void) | null {
		const action = afterGuard;
		afterGuard = null;
		guardOpen = false;
		return action;
	}

	async function guardSave() {
		const action = takeAfterGuard();
		if (await saveDraft()) action?.();
	}

	function guardDiscard() {
		const action = takeAfterGuard();
		discardDraft();
		action?.();
	}

	/* ---- Navigation ---- */

	function openSection(id: SettingsSectionId) {
		query = '';
		if (id === active) return;
		guarded(() => {
			revealId = null;
			chosen = id;
		});
	}

	function backToList() {
		guarded(() => {
			revealId = null;
			chosen = null;
		});
	}

	function requestOpenChange(next: boolean) {
		if (next) {
			open = true;
			return;
		}
		guarded(() => {
			open = false;
		});
	}

	/** Open the section a search hit belongs to and bring the setting into view. */
	function pickSearchHit(id: SettingsSectionId, targetId: string) {
		const go = async () => {
			query = '';
			revealId = null;
			chosen = id;
			await tick();
			revealId = targetId;
			await tick();
			requestAnimationFrame(() => {
				const el = document.getElementById(targetId);
				if (!el) return;
				/* A tall block (a list of sliders) shows from its top, not its middle. */
				const tall = el.getBoundingClientRect().height > window.innerHeight / 2;
				el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
				el.animate?.(
					[
						{ backgroundColor: 'color-mix(in oklab, var(--primary) 14%, transparent)' },
						{ backgroundColor: 'transparent' }
					],
					{ duration: 1600, easing: 'ease-out' }
				);
			});
		};
		if (id === active) void go();
		else guarded(() => void go());
	}

	/* Every opening starts from the top: first section on a wide screen, the list on a phone. */
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			chosen = null;
			query = '';
			revealId = null;
			saveError = '';
		}
		wasOpen = open;
	});
</script>

<Dialog.Root bind:open={() => open, requestOpenChange}>
	<Dialog.Content class="flex h-[min(44rem,92dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
		<div class="grid min-h-0 flex-1 sm:grid-cols-[13.5rem_minmax(0,1fr)]">
			<aside
				class={cn(
					'flex min-h-0 flex-col sm:border-r sm:bg-muted/30',
					active && !wide.current && 'hidden'
				)}
			>
				<div class="space-y-3 px-4 pt-5 pb-3">
					<Dialog.Title class="px-1">Settings</Dialog.Title>
					<Dialog.Description class="sr-only">
						Settings for playing, controls, sound, privacy and play time.
					</Dialog.Description>
					<div class="relative">
						<Search
							class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<input
							type="search"
							bind:value={query}
							placeholder="Search"
							aria-label="Search settings"
							autocomplete="off"
							class="h-9 w-full rounded-md border border-input bg-background ps-8 pe-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
						/>
					</div>
				</div>

				<!--
					min-h-0 is load-bearing: a flex child defaults to min-height:auto and
					refuses to shrink below its content, so without it this list stays full
					height, Dialog.Content's overflow-hidden clips it, and the rows past the
					fold are unreachable on a phone with nothing scrolling.
				-->
				<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
					{#if searching && !wide.current}
						<div class="px-2 pt-1">
							<SettingsSearchResults groups={resultGroups} onPick={pickSearchHit} />
						</div>
					{:else}
						<nav aria-label="Settings sections">
							<ul class="space-y-0.5" role="list">
								{#each sections as section (section.id)}
									<li>
										<button
											type="button"
											aria-current={active === section.id ? 'page' : undefined}
											class={cn(
												'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:py-2',
												active === section.id
													? 'bg-accent text-accent-foreground'
													: 'hover:bg-muted/70'
											)}
											onclick={() => openSection(section.id)}
										>
											<section.icon
												class="size-4 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
											<span class="min-w-0 flex-1">
												<span class="block text-sm font-medium">{section.title}</span>
												<span class="block truncate text-xs text-muted-foreground sm:hidden">
													{section.description}
												</span>
											</span>
											<ChevronRight
												class="size-4 shrink-0 text-muted-foreground sm:hidden"
												aria-hidden="true"
											/>
										</button>
									</li>
								{/each}
							</ul>
						</nav>
					{/if}
				</div>
			</aside>

			{#if active && activeDef}
				<div class="flex min-h-0 flex-col">
					<header class="flex items-center gap-2 border-b px-4 py-4 pe-12 sm:px-6 sm:pe-12">
						<Button
							variant="ghost"
							size="icon"
							class="-ms-2 shrink-0 sm:hidden"
							onclick={backToList}
							aria-label="Back to settings"
						>
							<ChevronLeft class="size-5" />
						</Button>
						<div class="min-w-0">
							{#if searching && wide.current}
								<h2 class="text-base leading-tight font-semibold">Search</h2>
								<p class="text-xs text-muted-foreground">
									{resultCount}
									{resultCount === 1 ? 'match' : 'matches'}
								</p>
							{:else}
								<h2 class="text-base leading-tight font-semibold">{activeDef.title}</h2>
								<p class="text-xs text-muted-foreground">{activeDef.description}</p>
							{/if}
						</div>
					</header>

					{#key active}
						<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
							{#if searching && wide.current}
								<SettingsSearchResults groups={resultGroups} onPick={pickSearchHit} />
							{/if}
							<!-- Hidden, not unmounted, while searching, so unsaved edits survive a search. -->
							<div class:hidden={searching && wide.current}>
								{#if active === 'playing'}
									<GamesSection searchQuery="" />
								{:else if active === 'controls'}
									<ControlsSection />
								{:else if active === 'sound'}
									<SoundSection />
								{:else if active === 'privacy'}
									<PrivacySection />
								{:else if active === 'play-time'}
									<PlayTimeSection />
								{:else if active === 'app'}
									<AppSection />
								{/if}
							</div>
						</div>
					{/key}

					{#if pending > 0 || saveError}
						<div
							class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3 sm:px-6"
						>
							<p
								class={cn(
									'min-w-0 flex-1 text-xs',
									saveError ? 'text-destructive' : 'text-muted-foreground'
								)}
								role={saveError ? 'alert' : 'status'}
							>
								{saveError || `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}`}
							</p>
							<Button
								variant="ghost"
								size="sm"
								onclick={discardDraft}
								disabled={saving || pending === 0}
							>
								Discard
							</Button>
							<Button size="sm" onclick={() => void saveDraft()} disabled={saving || pending === 0}>
								Save
							</Button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	bind:open={guardOpen}
	onOpenChange={(o) => {
		if (!o) afterGuard = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Save your changes?</AlertDialog.Title>
			<AlertDialog.Description>
				{activeDef?.title ?? 'This section'} has {pending} unsaved {pending === 1
					? 'change'
					: 'changes'}.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<Button variant="outline" onclick={guardDiscard}>Discard</Button>
			<Button onclick={() => void guardSave()}>Save</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
