<script lang="ts">
	/**
	 * Updates UI preview (dev only): the top-bar badge and Settings → App → Updates in any
	 * platform and state, without an APK or AndySU. scripts/smoke-updates.mjs screenshots it.
	 *
	 * Query: platform=android-apk|android-live|desktop|web, phase=idle|checking|up-to-date|
	 * available|downloading|staged|error, installed, latest, progress (0–100), apply=live.
	 */
	import AppUpdateBadge from '$lib/components/AppUpdateBadge.svelte';
	import AppSection from '$lib/components/settings/sections/app/AppSection.svelte';
	import { setSettingsUiContext, type SettingsTarget } from '$lib/settings-ui-context';
	import { updates, type UpdatePhase, type UpdatePlatform } from '$lib/utils/update-center.svelte';

	const q = new URLSearchParams(window.location.search);
	updates.platform = (q.get('platform') as UpdatePlatform) ?? 'android-apk';
	updates.phase = (q.get('phase') as UpdatePhase) ?? 'up-to-date';
	updates.installed = q.get('installed') ?? '0.0.97';
	updates.latest = q.get('latest') ?? '0.0.103';
	updates.progress = Number(q.get('progress') ?? 42);
	updates.error = updates.phase === 'error' ? 'GitHub Releases returned 403' : '';
	if (q.get('apply') === 'live') updates.settings = { ...updates.settings, applyMode: 'live' };

	let opened = $state<SettingsTarget | null>(null);
	setSettingsUiContext({ openSettings: (t) => (opened = t ?? null) });
</script>

<div class="mx-auto w-full max-w-xl space-y-4 p-4">
	<div
		class="flex items-center justify-between rounded-lg border bg-background px-3 py-2"
		data-testid="preview-topbar"
	>
		<span class="text-sm font-semibold">Potato Tomato</span>
		<div class="flex items-center gap-2"><AppUpdateBadge compact /><AppUpdateBadge /></div>
	</div>
	<p class="text-xs text-muted-foreground" data-testid="preview-opened">
		{opened ? `opens ${opened.section} → ${opened.targetId}` : 'badge not tapped'}
	</p>
	<div class="rounded-lg border bg-background p-2"><AppSection /></div>
</div>
