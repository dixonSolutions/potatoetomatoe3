<script lang="ts">
	import {
		getMasterVolume,
		getMuteAudioScope,
		saveMasterVolume,
		saveMuteAudioScope,
		type MuteAudioScope
	} from '$lib/utils/audio-mute';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';
	import SettingsSelect from '../../shared/SettingsSelect.svelte';
	import SettingsSlider from '../../shared/SettingsSlider.svelte';
	import { SettingsDraftState } from '../../settings-draft.svelte';
	import { getSettingsShellContext, useSettingsDraft } from '../../settings-section-context';

	const shell = getSettingsShellContext();

	const draft = new SettingsDraftState(() => ({
		volumePct: Math.round(getMasterVolume() * 100),
		muteScope: getMuteAudioScope()
	}));

	useSettingsDraft({
		get pending() {
			return draft.pending;
		},
		save() {
			const { volumePct, muteScope } = draft.value;
			if (draft.changed('muteScope')) saveMuteAudioScope(muteScope);
			if (draft.changed('volumePct')) saveMasterVolume(volumePct / 100);
			draft.commit();
			shell?.applied();
			return null;
		},
		discard: () => draft.reset()
	});

	const MUTE_OPTIONS: { value: MuteAudioScope; label: string; hint: string }[] = [
		{ value: 'off', label: 'Never', hint: 'Sound always plays.' },
		{
			value: 'focus_loss',
			label: 'In the background',
			hint: 'Mutes when you switch to another tab or app.'
		},
		{ value: 'always', label: 'Always', hint: 'Everything on this site stays silent.' }
	];

	const forcedSilent = $derived(draft.value.muteScope === 'always');
</script>

<div class="space-y-6">
	<SettingsGroup>
		<SettingsRow
			id="settings-section-audio-volume"
			label="Volume"
			labelFor="master-volume"
			hint={forcedSilent
				? 'Muted while Mute is set to Always.'
				: 'For games and videos on this site.'}
		>
			<SettingsSlider
				id="master-volume"
				min={0}
				max={100}
				value={draft.value.volumePct}
				display={`${draft.value.volumePct}%`}
				disabled={forcedSilent}
				onValueChange={(v) => draft.set('volumePct', v)}
			/>
		</SettingsRow>
		<SettingsRow
			id="settings-section-audio-mute"
			label="Mute"
			hint={MUTE_OPTIONS.find((o) => o.value === draft.value.muteScope)?.hint}
		>
			<SettingsSelect
				label="Mute"
				value={draft.value.muteScope}
				options={MUTE_OPTIONS}
				onValueChange={(v) => draft.set('muteScope', v)}
			/>
		</SettingsRow>
	</SettingsGroup>

	<p id="settings-section-audio-embeds" class="scroll-mt-4 px-1 text-xs text-muted-foreground">
		Some embedded games ignore this. Use the tab or system mute for those.
	</p>
</div>
