<script lang="ts">
	import Label from '$lib/components/ui/label/label.svelte';
	import type { GameHostMode } from '$lib/utils/game-host-mode';
	import { sectionMatches } from '$lib/components/settings/search';
	import { HardDrive, Wifi } from 'lucide-svelte';

	let {
		searchQuery,
		busy = false,
		gameHostMode = $bindable<GameHostMode>('offline'),
		message = '',
		error = ''
	}: {
		searchQuery: string;
		busy?: boolean;
		gameHostMode?: GameHostMode;
		message?: string;
		error?: string;
	} = $props();

	const OPTIONS: { value: GameHostMode; label: string; hint: string }[] = [
		{
			value: 'offline',
			label: 'Offline — local mirror',
			hint: 'Open the mirrored build under `offline/` when it exists (local HTML, scripts, and assets on disk). No third-party page is embedded—only files served by this app. Default.'
		},
		{
			value: 'online',
			label: 'Online — original shell',
			hint: 'Always open each game’s root `online/index.html` (portal wrapper). That shell may still load remote iframes, CDNs, or ads depending on the title.'
		}
	];

	function shouldShowMessage(m: string): boolean {
		const t = m.trim().toLowerCase();
		if (t.includes('privacy mode is on') || t.includes('privacy mode is off')) return false;
		return m.length > 0;
	}
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'game hosting mode offline local bundle online shell iframe cdn')}
		<div id="settings-section-mode-host" class="scroll-mt-32 space-y-2">
			<div class="flex items-center gap-2">
				<HardDrive class="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
				<Label for="settings-game-host-mode">Game hosting</Label>
			</div>
			<p class="text-xs text-muted-foreground">
				Controls which entry file under <code class="rounded bg-muted px-1 font-mono text-[11px]">online/</code> the player opens (still your static files only in offline mode). Reload an open game page after changing this.
			</p>
			<select
				id="settings-game-host-mode"
				bind:value={gameHostMode}
				disabled={busy}
				class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
			>
				{#each OPTIONS as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				{OPTIONS.find((o) => o.value === gameHostMode)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'wifi network remote assets cdn')}
		<p
			id="settings-section-mode-note"
			class="scroll-mt-32 flex gap-2 text-xs leading-relaxed text-muted-foreground"
		>
			<Wifi class="h-4 w-4 mt-0.5 shrink-0 opacity-80" aria-hidden="true" />
			<span
				><strong class="font-medium text-foreground">Online mode</strong> does not guarantee every title works offline; it only switches which entry file we open. Run
				<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">pnpm games:ensure-all-local</code>
				to pull local mirrors for the catalog.</span
			>
		</p>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'game hosting mode offline local bundle online shell iframe cdn') && !sectionMatches(searchQuery, 'wifi network remote assets cdn')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}

	{#if shouldShowMessage(message)}
		<p class="text-sm text-muted-foreground">{message}</p>
	{/if}
	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}
</div>
