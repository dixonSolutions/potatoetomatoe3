<script lang="ts">
	/**
	 * The game's controls, as a menu — not a keyboard parked over the game.
	 *
	 * "Detected" lists what the game reads, what each key does and how we know, five rows
	 * high and scrolling beyond that. Keys are sorted into what the console can help with:
	 *
	 *   Game controls  press them here (real holds — press is keydown, release keyup)
	 *   Shortcuts      only ever handled with Ctrl / Alt / Meta — listed, not pressable
	 *   Typing         the game has a text box; the device keyboard handles that
	 *
	 * "All keys" is the full board, for accessibility and for anything detection missed.
	 * Search filters both by key or by what it does.
	 */
	import { Search, X, Keyboard as KeyboardIcon } from 'lucide-svelte';
	import {
		detectedControls,
		keyEvidence,
		keyProfileLooksLikeTyping,
		keyPurpose,
		type DetectedControl,
		type KeyEvidence,
		type KeyProfile
	} from '$lib/utils/key-profile';
	import { keyLabel } from '$lib/utils/touch-console';

	let {
		profile,
		canSend = true,
		onDown,
		onUp,
		onClose,
		onTypeWithDevice
	}: {
		profile: KeyProfile;
		/** False while no path into the game frame exists — keys are shown but inert. */
		canSend?: boolean;
		onDown: (code: string) => void;
		onUp: (code: string) => void;
		onClose: () => void;
		onTypeWithDevice?: () => void;
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

	const EVIDENCE_LABEL: Record<KeyEvidence, string> = {
		used: 'In use',
		bound: 'Bound',
		inferred: 'Likely',
		declared: 'Mentioned',
		none: ''
	};

	/* What to say when the controls text gave no purpose. */
	const EVIDENCE_FALLBACK: Record<KeyEvidence, string> = {
		used: 'The game responds to it',
		bound: 'Registered by the game engine',
		inferred: 'Found in the game’s key handling',
		declared: 'Only mentioned in text',
		none: ''
	};

	let tab = $state<Tab>('detected');
	let query = $state('');

	const all = $derived(detectedControls(profile));
	const typingGame = $derived(keyProfileLooksLikeTyping(profile));

	function matches(c: { code: string; purpose?: string }, q: string): boolean {
		if (!q) return true;
		const needle = q.trim().toLowerCase();
		return (
			keyLabel(c.code).toLowerCase().includes(needle) ||
			c.code.toLowerCase().includes(needle) ||
			(c.purpose ?? '').toLowerCase().includes(needle)
		);
	}

	const filtered = $derived(all.filter((c) => matches(c, query)));
	/* Confirmed by the running game; text-only mentions are listed apart, as unconfirmed. */
	const gameplay = $derived(
		grouped(filtered.filter((c) => c.kind === 'gameplay' && c.evidence !== 'declared'))
	);
	const mentioned = $derived(
		grouped(filtered.filter((c) => c.kind === 'gameplay' && c.evidence === 'declared'))
	);
	const shortcuts = $derived(grouped(filtered.filter((c) => c.kind === 'shortcut')));
	const typing = $derived(filtered.filter((c) => c.kind === 'typing'));
	const gameplayCount = $derived(
		grouped(all.filter((c) => c.kind === 'gameplay' && c.evidence !== 'declared')).length
	);

	type Group = {
		key: string;
		codes: string[];
		evidence: KeyEvidence;
		kind: DetectedControl['kind'];
		purpose: string;
	};

	const RANK: Record<KeyEvidence, number> = {
		used: 0,
		bound: 1,
		inferred: 2,
		declared: 3,
		none: 4
	};

	/*
	 * Keys that do the same thing share a row — "↑ ↓ ← → Move" is one control, not four —
	 * so five rows go a long way. Keys with no known purpose stay one per row.
	 */
	function grouped(list: DetectedControl[]): Group[] {
		const out: Group[] = [];
		const byPurpose: Record<string, Group> = {};
		for (const c of list) {
			const k = c.purpose ? `${c.kind}|${c.purpose.toLowerCase()}` : '';
			const existing = k ? byPurpose[k] : undefined;
			if (existing) {
				existing.codes.push(c.code);
				if (RANK[c.evidence] < RANK[existing.evidence]) existing.evidence = c.evidence;
				continue;
			}
			const g: Group = {
				key: k || c.code,
				codes: [c.code],
				evidence: c.evidence,
				kind: c.kind,
				purpose: c.purpose
			};
			out.push(g);
			if (k) byPurpose[k] = g;
		}
		return out.sort((a, b) => RANK[a.evidence] - RANK[b.evidence]);
	}

	/* pointerId -> code, so chords and releases outside the key both work. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping; `pressed` renders
	const held = new Map<number, string>();
	let pressed = $state<Record<string, boolean>>({});

	function press(e: PointerEvent, code: string) {
		if (e.button != null && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (!canSend) return;
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

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		}
	}

	function dot(evidence: KeyEvidence): string {
		switch (evidence) {
			case 'used':
				return 'bg-emerald-500';
			case 'bound':
				return 'bg-sky-500';
			case 'inferred':
				return 'bg-amber-500';
			default:
				return 'bg-muted-foreground/50';
		}
	}

	/* Evidence tints that read on both the light and the dark popover. */
	function capClass(evidence: KeyEvidence): string {
		switch (evidence) {
			case 'used':
				return 'border-emerald-500/70 bg-emerald-500/15 text-emerald-900 dark:text-emerald-100';
			case 'bound':
				return 'border-sky-500/70 bg-sky-500/15 text-sky-950 dark:text-sky-100';
			case 'inferred':
				return 'border-amber-500/60 bg-amber-500/10 text-amber-950 dark:text-amber-100';
			default:
				return 'border-border bg-muted text-muted-foreground';
		}
	}
</script>

{#snippet row(g: Group, pressable: boolean)}
	<li
		class="flex min-h-11 items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-accent/60"
		data-code={g.codes[0]}
		data-codes={g.codes.join(' ')}
	>
		<span class="flex shrink-0 flex-wrap gap-1">
			{#each g.codes as code (code)}
				<button
					type="button"
					data-console-control
					data-code={code}
					class="flex h-9 min-w-9 touch-none items-center justify-center rounded-lg border px-2 text-xs font-bold select-none {capClass(
						g.evidence
					)} {pressed[code] ? 'scale-95 brightness-150' : ''} {pressable && canSend
						? ''
						: 'cursor-default opacity-70'}"
					aria-label={`${keyLabel(code)}${g.purpose ? ` — ${g.purpose}` : ''}`}
					disabled={!pressable}
					onpointerdown={(e) => pressable && press(e, code)}
					onpointerup={release}
					onpointercancel={release}
				>
					{keyLabel(code)}
				</button>
			{/each}
		</span>
		<span
			class="min-w-0 flex-1 truncate text-[13px] {g.purpose
				? 'text-foreground'
				: 'text-muted-foreground'}"
		>
			{#if g.kind === 'shortcut'}
				{g.purpose || 'Shortcut'} <span class="text-muted-foreground">· with Ctrl / ⌘</span>
			{:else}
				{g.purpose || EVIDENCE_FALLBACK[g.evidence]}
			{/if}
		</span>
		<span
			class="flex shrink-0 items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
			data-evidence={g.evidence}
		>
			<i class="size-2 rounded-full {dot(g.evidence)}"></i>{EVIDENCE_LABEL[g.evidence]}
		</span>
	</li>
{/snippet}

<div
	class="pointer-events-auto flex max-h-full w-[min(440px,94%)] flex-col gap-2 rounded-2xl border border-border bg-popover/95 p-2.5 text-popover-foreground shadow-xl backdrop-blur-xl"
	role="dialog"
	aria-label="Game controls"
	tabindex="-1"
	data-console-control
	data-testid="controls-menu"
	onkeydown={onKeydown}
>
	<div class="flex items-center gap-2">
		<div
			class="flex rounded-full border border-border bg-muted p-0.5 text-[11px] font-semibold"
			role="tablist"
		>
			<button
				type="button"
				role="tab"
				data-console-control
				class="rounded-full px-2.5 py-1 {tab === 'detected'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground'}"
				aria-selected={tab === 'detected'}
				onclick={() => (tab = 'detected')}
			>
				Controls detected <span class="opacity-70">{gameplayCount}</span>
			</button>
			<button
				type="button"
				role="tab"
				data-console-control
				class="rounded-full px-2.5 py-1 {tab === 'all'
					? 'bg-background text-foreground shadow-sm'
					: 'text-muted-foreground'}"
				aria-selected={tab === 'all'}
				onclick={() => (tab = 'all')}
			>
				All keys
			</button>
		</div>
		<button
			type="button"
			data-console-control
			class="ml-auto flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted hover:bg-accent"
			aria-label="Close controls"
			onclick={onClose}
		>
			<X class="size-3.5" />
		</button>
	</div>

	<label
		class="flex h-8 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-ring/50"
	>
		<Search class="size-3.5 shrink-0 opacity-70" />
		<input
			type="search"
			data-console-control
			class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
			placeholder="Search a key or what it does"
			aria-label="Search controls"
			bind:value={query}
		/>
	</label>

	{#if !canSend}
		<p class="px-1 text-[11px] text-amber-700 dark:text-amber-300" role="status">
			This game frame can’t receive keys from here — keys are listed but won’t press.
		</p>
	{/if}

	{#if tab === 'detected'}
		<!-- Five rows high, then scroll. -->
		<div
			class="max-h-[236px] overflow-y-auto overscroll-contain pr-0.5"
			data-testid="controls-list"
		>
			{#if all.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground" role="status">
					Listening for the keys this game reads… They appear here as they are found, and as you
					play. <b>All keys</b> has every key meanwhile.
				</p>
			{:else if filtered.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground" role="status">
					Nothing matches “{query}”.
				</p>
			{:else}
				{#if gameplay.length}
					<ul aria-label="Game controls" data-section="gameplay">
						{#each gameplay as g (g.key)}
							{@render row(g, true)}
						{/each}
					</ul>
				{/if}
				{#if mentioned.length}
					<p
						class="mt-2 mb-0.5 px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
						title="Named in the game’s description or page text, but not seen in the running game"
					>
						Mentioned in text · not confirmed
					</p>
					<ul aria-label="Mentioned in text" data-section="mentioned">
						{#each mentioned as g (g.key)}
							{@render row(g, true)}
						{/each}
					</ul>
				{/if}
				{#if shortcuts.length}
					<p
						class="mt-2 mb-0.5 px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
					>
						Shortcuts
					</p>
					<ul aria-label="Shortcuts" data-section="shortcut">
						{#each shortcuts as g (g.key)}
							{@render row(g, false)}
						{/each}
					</ul>
				{/if}
				{#if typing.length || typingGame}
					<div
						class="mt-2 flex items-center gap-2 rounded-xl border border-border bg-muted px-2.5 py-2"
						data-section="typing"
					>
						<KeyboardIcon class="size-4 shrink-0 opacity-80" />
						<p class="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
							This game takes typed text{typing.length
								? ` (${typing.length} letter${typing.length === 1 ? '' : 's'})`
								: ''} — use your device keyboard for that.
						</p>
						{#if onTypeWithDevice}
							<button
								type="button"
								data-console-control
								data-testid="type-with-device"
								class="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-accent"
								onclick={onTypeWithDevice}
							>
								Type
							</button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-1" data-testid="controls-keyboard">
			{#each ROWS as keys, i (i)}
				<div class="flex justify-center gap-1">
					{#each keys as code (code)}
						{@const evidence = keyEvidence(profile, code)}
						{@const hit = matches({ code, purpose: keyPurpose(profile, code) }, query)}
						<button
							type="button"
							data-console-control
							data-code={code}
							data-evidence={evidence}
							class="flex h-9 min-w-0 touch-none items-center justify-center rounded-lg border text-xs font-bold select-none {capClass(
								evidence
							)} {pressed[code] ? 'scale-95 brightness-150' : ''} {hit ? '' : 'opacity-25'}"
							style={`flex:${WIDE[code] ?? 1} 1 0;`}
							title={keyPurpose(profile, code)}
							aria-label={`${keyLabel(code)}${keyPurpose(profile, code) ? ` — ${keyPurpose(profile, code)}` : ''}`}
							onpointerdown={(e) => press(e, code)}
							onpointerup={release}
							onpointercancel={release}
						>
							{keyLabel(code)}
						</button>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>
