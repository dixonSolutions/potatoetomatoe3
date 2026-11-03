<script lang="ts">
	/**
	 * Phone-sized preview of the in-game menu (dev only). Shows the menu in the state an
	 * Android device is in after leaving fullscreen, without installing the APK.
	 *
	 * Query (all optional):
	 *   fullscreen=0|1   game fills the frame (default 0: windowed, the state under test)
	 *   touch=0|1        touch layout and sizes (default 1)
	 *   size=auto|small|medium|large   (default auto)
	 *   corner=top-left|top-right|bottom-left|bottom-right   (default top-left)
	 *   fsButton=0|1     enter/exit fullscreen button beside the menu button (default 1)
	 *   open=1           start with the panel open
	 */
	import InGameMenu from '$lib/components/game-player/in-game-menu/InGameMenu.svelte';
	import type { InGameMenuButtonSize, InGameMenuCorner } from '$lib/utils/game-player-settings';

	const params = new URLSearchParams(window.location.search);
	const SIZES: InGameMenuButtonSize[] = ['auto', 'small', 'medium', 'large'];
	const CORNERS: InGameMenuCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

	const size = SIZES.find((s) => s === params.get('size')) ?? 'auto';
	const corner = CORNERS.find((c) => c === params.get('corner')) ?? 'top-left';
	const touch = params.get('touch') !== '0';
	const fullscreen = params.get('fullscreen') === '1';
	const fullscreenButton = params.get('fsButton') !== '0';

	let open = $state(params.get('open') === '1');
	let lastAction = $state('none');
</script>

<svelte:head>
	<title>In-game menu preview</title>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<main class="min-h-screen bg-neutral-900 p-4 text-neutral-200">
	<p class="mb-3 font-mono text-xs">
		fullscreen={fullscreen ? 'on' : 'off'} · touch={touch ? 'on' : 'off'} · size={size} · corner={corner}
		· fsButton={fullscreenButton ? 'on' : 'off'} · last action: {lastAction}
	</p>
	<div
		data-testid="menu-preview-surface"
		class="relative overflow-hidden rounded-lg bg-gradient-to-br from-sky-700 to-emerald-800"
		style="width: 412px; height: 915px; max-width: 100%;"
	>
		<InGameMenu
			{corner}
			access="button"
			buttonSize={size}
			{touch}
			{fullscreen}
			{fullscreenButton}
			bind:open
			onGesture={() => (lastAction = 'gesture')}
			onTogglePause={() => (lastAction = 'pause')}
			onRestart={() => (lastAction = 'restart')}
			onToggleConsole={() => (lastAction = 'console')}
			onOpenControls={() => (lastAction = 'controls')}
			onToggleFullscreen={() => (lastAction = 'fullscreen')}
			onBack={() => (lastAction = 'back')}
			onClosed={() => (lastAction = 'closed')}
		/>
	</div>
</main>
