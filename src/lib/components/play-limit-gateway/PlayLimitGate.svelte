<script lang="ts">
	import { browser } from '$app/environment';
	import Button from '$lib/components/ui/button/button.svelte';
	import { getSettingsUiContext } from '$lib/settings-ui-context';
	import { disableDailyPlayLimits } from '$lib/utils/play-recommendations';
	import { Gauge } from 'lucide-svelte';

	const settingsUi = getSettingsUiContext();

	function openAnalyticsSettings() {
		settingsUi?.openSettings();
	}

	function disableTimeLimit() {
		disableDailyPlayLimits();
		if (browser) {
			window.dispatchEvent(new CustomEvent('potato-tomato-play-limits-changed'));
		}
	}
</script>

<div
	class="fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-background/95 p-6 backdrop-blur-sm"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="play-limit-heading"
	aria-describedby="play-limit-desc"
>
	<div class="max-w-md space-y-4 text-center">
		<div class="flex justify-center">
			<div
				class="flex h-14 w-14 items-center justify-center rounded-full bg-muted border border-border"
				aria-hidden="true"
			>
				<Gauge class="h-7 w-7 text-muted-foreground" />
			</div>
		</div>
		<h2 id="play-limit-heading" class="text-xl font-semibold tracking-tight">Daily playtime limit reached</h2>
		<p id="play-limit-desc" class="text-sm text-muted-foreground leading-relaxed">
			You’ve reached your daily cap for this site. Limits reset on the next UTC day, or you can turn the limit off
			below.
		</p>
		<div class="flex flex-wrap items-center justify-center gap-2 pt-2">
			<Button type="button" onclick={disableTimeLimit}>Disable time limit</Button>
			<Button type="button" variant="outline" onclick={openAnalyticsSettings}>Open settings</Button>
		</div>
	</div>
</div>
