<script lang="ts">
	/**
	 * On-screen keyboard for the touch console, driven by live key detection.
	 *
	 * Every key the console can send is here, lit by how sure we are the game reads it:
	 * seen in use (the game handled a press), named in its controls text, or found in its
	 * handler source. "Detected" lists only those, strongest first, so the keys a game
	 * actually needs are one tap away; "All" is the full board for anything detection
	 * missed. Keys are real holds — press is keydown, release is keyup — not taps.
	 */
	import { X } from 'lucide-svelte';
	import { keyEvidence, type KeyEvidence, type KeyProfile } from '$lib/utils/key-profile';

	let {
		profile,
		opacity = 0.9,
		onDown,
		onUp,
		onClose
	}: {
		profile: KeyProfile;
		opacity?: number;
		onDown: (code: string) => void;
		onUp: (code: string) => void;
		onClose: () => void;
	} = $props();

	type Tab = 'detected' | 'all';

	const ROWS: string[][] = [
		[
			'Escape',
			'Digit1',
			'Digit2',
			'Digit3',
			'Digit4',
			'Digit5',
			'Digit6',
			'Digit7',
			'Digit8',
			'Digit9',
			'Digit0'
		],
		['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
		['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Enter'],
		['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'ArrowUp'],
		['ControlLeft', 'Space', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
	];

	const WIDE: Record<string, number> = {
		Space: 4,
		ShiftLeft: 1.5,
		ControlLeft: 1.5,
		Enter: 1.5,
		Escape: 1.2
	};

	const RANK: Record<KeyEvidence, number> = { used: 0, declared: 1, inferred: 2, none: 3 };

	const EVIDENCE_LABEL: Record<KeyEvidence, string> = {
		used: 'In use',
		declared: 'Listed',
		inferred: 'Likely',
		none: ''
	};

	function label(code: string): string {
		if (code.startsWith('Key')) return code.slice(3);
		if (code.startsWith('Digit')) return code.slice(5);
		switch (code) {
			case 'ArrowUp':
				return '↑';
			case 'ArrowDown':
				return '↓';
			case 'ArrowLeft':
				return '←';
			case 'ArrowRight':
				return '→';
			case 'Escape':
				return 'Esc';
			case 'ShiftLeft':
				return 'Shift';
			case 'ControlLeft':
				return 'Ctrl';
			default:
				return code;
		}
	}

	const detected = $derived(
		ROWS.flat()
			.map((code) => ({ code, evidence: keyEvidence(profile, code) }))
			.filter((k) => k.evidence !== 'none')
			.sort((a, b) => RANK[a.evidence] - RANK[b.evidence] || a.code.localeCompare(b.code))
	);

	let tab = $state<Tab | null>(null);
	/* Until the player picks, show detected keys once there are any. */
	const activeTab = $derived<Tab>(tab ?? (detected.length > 0 ? 'detected' : 'all'));

	/*
	 * pointerId -> code, so multi-touch chords and releases outside the key both work.
	 * Bookkeeping only — `pressed` is what renders — so it stays a plain Map.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const held = new Map<number, string>();
	let pressed = $state<Record<string, boolean>>({});

	function press(e: PointerEvent, code: string) {
		if (e.button != null && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			/* synthetic pointer — no capture */
		}
		held.set(e.pointerId, code);
		pressed = { ...pressed, [code]: true };
		onDown(code);
	}

	function release(e: PointerEvent) {
		const code = held.get(e.pointerId);
		if (!code) return;
		held.delete(e.pointerId);
		if (![...held.values()].includes(code)) {
			const next = { ...pressed };
			delete next[code];
			pressed = next;
			onUp(code);
		}
	}

	/* Closing mid-press must not leave a key stuck down in the game. */
	$effect(() => {
		return () => {
			for (const code of new Set(held.values())) onUp(code);
			held.clear();
		};
	});

	function evidenceClass(evidence: KeyEvidence): string {
		switch (evidence) {
			case 'used':
				return 'border-emerald-300/90 bg-emerald-400/30 text-white';
			case 'declared':
				return 'border-sky-300/80 bg-sky-400/25 text-white';
			case 'inferred':
				return 'border-amber-300/60 bg-amber-300/15 text-white/90';
			default:
				return 'border-white/15 bg-white/5 text-white/45';
		}
	}
</script>

<div
	class="pointer-events-auto flex max-h-full w-[min(560px,96%)] flex-col gap-2 rounded-2xl border border-white/20 bg-black/65 p-2 text-white shadow-[0_10px_40px_rgb(0_0_0_/0.45)] backdrop-blur-xl"
	style={`opacity:${opacity};`}
	role="group"
	aria-label="On-screen keyboard"
	data-console-control
	data-testid="onscreen-keyboard"
>
	<div class="flex items-center gap-1.5">
		<div
			class="flex rounded-full border border-white/15 bg-white/5 p-0.5 text-[11px] font-semibold"
		>
			<button
				type="button"
				data-console-control
				class="rounded-full px-2.5 py-1 {activeTab === 'detected'
					? 'bg-white/20'
					: 'text-white/70'}"
				aria-pressed={activeTab === 'detected'}
				onclick={() => (tab = 'detected')}
			>
				Detected <span class="opacity-70">{detected.length}</span>
			</button>
			<button
				type="button"
				data-console-control
				class="rounded-full px-2.5 py-1 {activeTab === 'all' ? 'bg-white/20' : 'text-white/70'}"
				aria-pressed={activeTab === 'all'}
				onclick={() => (tab = 'all')}
			>
				All keys
			</button>
		</div>
		<div
			class="ml-auto hidden items-center gap-2 text-[10px] text-white/70 sm:flex"
			aria-hidden="true"
		>
			<span class="flex items-center gap-1"
				><i class="size-2 rounded-full bg-emerald-400"></i>In use</span
			>
			<span class="flex items-center gap-1"
				><i class="size-2 rounded-full bg-sky-400"></i>Listed</span
			>
			<span class="flex items-center gap-1"
				><i class="size-2 rounded-full bg-amber-300"></i>Likely</span
			>
		</div>
		<button
			type="button"
			data-console-control
			class="ml-auto flex size-7 items-center justify-center rounded-full border border-white/20 bg-white/10 sm:ml-1"
			aria-label="Close keyboard"
			onclick={onClose}
		>
			<X class="size-3.5" />
		</button>
	</div>

	{#if activeTab === 'detected'}
		{#if detected.length === 0}
			<p class="px-1 py-2 text-xs text-white/75" role="status">
				Listening for the keys this game reads… Keys light up here as they are found, and as you use
				them. Switch to <b>All keys</b> meanwhile.
			</p>
		{:else}
			<div class="flex flex-wrap gap-1.5" data-testid="onscreen-keyboard-detected">
				{#each detected as key (key.code)}
					<button
						type="button"
						data-console-control
						data-code={key.code}
						data-evidence={key.evidence}
						class="flex h-11 min-w-11 touch-none flex-col items-center justify-center rounded-xl border px-2.5 leading-none font-bold select-none {evidenceClass(
							key.evidence
						)} {pressed[key.code] ? 'scale-95 brightness-150' : ''}"
						aria-label={`${label(key.code)} (${EVIDENCE_LABEL[key.evidence]})`}
						onpointerdown={(e) => press(e, key.code)}
						onpointerup={release}
						onpointercancel={release}
					>
						<span class="text-sm">{label(key.code)}</span>
						<span class="mt-0.5 text-[8px] font-semibold tracking-wide uppercase opacity-75"
							>{EVIDENCE_LABEL[key.evidence]}</span
						>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="flex flex-col gap-1" data-testid="onscreen-keyboard-all">
			{#each ROWS as row, i (i)}
				<div class="flex justify-center gap-1">
					{#each row as code (code)}
						{@const evidence = keyEvidence(profile, code)}
						<button
							type="button"
							data-console-control
							data-code={code}
							data-evidence={evidence}
							class="flex h-9 min-w-0 touch-none items-center justify-center rounded-lg border text-xs font-bold select-none {evidenceClass(
								evidence
							)} {pressed[code] ? 'scale-95 brightness-150' : ''}"
							style={`flex:${WIDE[code] ?? 1} 1 0;`}
							aria-label={label(code)}
							onpointerdown={(e) => press(e, code)}
							onpointerup={release}
							onpointercancel={release}
						>
							{label(code)}
						</button>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>
