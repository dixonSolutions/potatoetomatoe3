<script lang="ts">
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import type { MuteAudioScope } from '$lib/utils/audio-mute';
	import { sectionMatches } from '$lib/components/settings/search';

	let {
		searchQuery,
		busy = false,
		muteScopeChoice = $bindable<MuteAudioScope>('off'),
		volumeSliderPct = $bindable(100),
		message = '',
		error = ''
	}: {
		searchQuery: string;
		busy?: boolean;
		muteScopeChoice?: MuteAudioScope;
		volumeSliderPct?: number;
		message?: string;
		error?: string;
	} = $props();

	const MUTE_SCOPE_OPTIONS: { label: string; value: MuteAudioScope; hint: string }[] = [
		{
			label: 'Off',
			value: 'off',
			hint: 'Never force mute; audio plays normally (cross-origin games may still behave on their own).'
		},
		{
			label: 'When tab is in the background or window loses focus',
			value: 'focus_loss',
			hint: 'Mute when you switch to another tab or another window grabs focus (e.g. another app).'
		},
		{
			label: 'Always',
			value: 'always',
			hint: 'Always mute HTML audio and video on this site while this is selected.'
		}
	];

	function shouldShowMessage(m: string): boolean {
		const t = m.trim().toLowerCase();
		if (t.includes('privacy mode is on') || t.includes('privacy mode is off')) return false;
		return m.length > 0;
	}
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'mute audio scope background focus tab video')}
		<div id="settings-section-audio-mute" class="scroll-mt-32 space-y-2">
			<Label>Mute audio</Label>
			<p class="text-xs text-muted-foreground">
				When to force mute on this page’s videos and games. Cross-origin embedded games may still play sound; use
				browser or system controls for full silence.
			</p>
			<Select.Root
				type="single"
				value={muteScopeChoice}
				onValueChange={(v) => {
					if (v === 'off' || v === 'focus_loss' || v === 'always') muteScopeChoice = v;
				}}
				disabled={busy}
			>
				<Select.Trigger class="w-full">
					{MUTE_SCOPE_OPTIONS.find((o) => o.value === muteScopeChoice)?.label ?? 'Choose…'}
				</Select.Trigger>
				<Select.Content>
					{#each MUTE_SCOPE_OPTIONS as opt}
						<Select.Item value={opt.value}>{opt.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-xs text-muted-foreground">
				{MUTE_SCOPE_OPTIONS.find((o) => o.value === muteScopeChoice)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'master volume slider percent level html')}
		<div id="settings-section-audio-volume" class="scroll-mt-32 space-y-2">
			<div class="flex items-center justify-between gap-2">
				<Label for="master-volume">Master volume</Label>
				<span class="text-xs tabular-nums text-muted-foreground">{volumeSliderPct}%</span>
			</div>
			<p class="text-xs text-muted-foreground">
				Live level for HTML audio and video on this site. Disabled when mute scope is “Always” (output is forced
				silent).
			</p>
			<input
				id="master-volume"
				type="range"
				min="0"
				max="100"
				step="1"
				bind:value={volumeSliderPct}
				disabled={busy || muteScopeChoice === 'always'}
				class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={volumeSliderPct}
				aria-label="Master volume"
			/>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'embeds cross-origin web audio browser tab')}
		<p
			id="settings-section-audio-embeds"
			class="scroll-mt-32 text-xs leading-relaxed text-muted-foreground"
		>
			<strong class="font-medium text-foreground">Embeds:</strong> Cross-origin games may use Web Audio or ignore HTML
			volume; use your browser tab mute or system volume when sound still leaks through.
		</p>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'mute audio scope background focus tab video') && !sectionMatches(searchQuery, 'master volume slider percent level html') && !sectionMatches(searchQuery, 'embeds cross-origin web audio browser tab')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}

	{#if shouldShowMessage(message)}
		<p class="text-sm text-muted-foreground">{message}</p>
	{/if}
	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}
</div>
