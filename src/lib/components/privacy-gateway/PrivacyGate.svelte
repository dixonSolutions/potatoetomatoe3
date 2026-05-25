<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { verifyAndUnlock } from '$lib/utils/privacy-mode';
	import { toast } from 'svelte-sonner';
	import googleG from '$lib/assets/Google__G__logo.svg';
	import googleDocsLogo from '$lib/assets/Google_Docs_logo_(2014-2020).svg';

	const REDIRECT_AFTER_REMEMBER_ME = 'https://docs.google.com/document/u/0/';

	/** Material primary (MUI default); matches Google account blues closely. */
	const primary = '#1976d2';
	const primaryHover = '#1565c0';
	const onSurface = 'rgba(0, 0, 0, 0.87)';
	const onSurfaceVariant = 'rgba(0, 0, 0, 0.6)';
	const outline = 'rgba(0, 0, 0, 0.23)';
	/** Filled form field (Angular Material): surface tint behind underline. */
	const filledSurface = 'rgba(0, 0, 0, 0.06)';

	let { onUnlocked }: { onUnlocked: () => void } = $props();

	let password = $state('');
	let busy = $state(false);
	let passwordInputEl = $state<HTMLInputElement | null>(null);
	let rememberCheckboxEl = $state<HTMLInputElement | null>(null);
	let rememberDocsCover = $state(false);

	function resetRememberMeToUnchecked() {
		rememberDocsCover = false;
		if (rememberCheckboxEl) rememberCheckboxEl.checked = false;
	}

	function focusPasswordField() {
		const el = passwordInputEl;
		if (!el || busy) return;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					el.focus({ preventScroll: true });
				} catch {
					el.focus();
				}
			});
		});
	}

	onMount(() => {
		void tick().then(() => {
			resetRememberMeToUnchecked();
			focusPasswordField();
		});

		const onTabBecameActive = () => {
			if (document.visibilityState !== 'visible') return;
			void tick().then(() => focusPasswordField());
		};

		const onPageShow = (ev: Event) => {
			const e = ev as PageTransitionEvent;
			if (e.persisted) resetRememberMeToUnchecked();
		};

		document.addEventListener('visibilitychange', onTabBecameActive);
		window.addEventListener('focus', onTabBecameActive);
		window.addEventListener('pageshow', onPageShow);

		return () => {
			document.removeEventListener('visibilitychange', onTabBecameActive);
			window.removeEventListener('focus', onTabBecameActive);
			window.removeEventListener('pageshow', onPageShow);
		};
	});

	async function submit(e: Event) {
		e.preventDefault();
		const redirectToDocsCover = rememberCheckboxEl?.checked === true;
		busy = true;
		try {
			const ok = await verifyAndUnlock(password);
			if (ok) {
				password = '';
				if (redirectToDocsCover) {
					window.location.replace(REDIRECT_AFTER_REMEMBER_ME);
					return;
				}
				toast.success('Signed in');
				onUnlocked();
			} else {
				toast.error("Couldn't sign in");
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div
	class="privacy-gate-root fixed inset-0 z-[9999] isolate flex min-h-screen flex-col bg-[#fafafa] [color-scheme:light]"
	style="font-family: Roboto, Helvetica, Arial, sans-serif;"
	role="region"
	aria-labelledby="privacy-gate-heading"
>
	<div class="flex min-h-screen flex-col items-center justify-center p-6 sm:p-8">
		<div
			class="w-full max-w-[450px] overflow-hidden rounded border border-black/[0.08] bg-white px-6 py-10 sm:px-10 sm:py-12"
			style="box-shadow: 0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12);"
		>
			<div class="mb-8 flex flex-col items-center text-center">
				<img src={googleG} alt="" class="mb-6 h-12 w-12" width="48" height="48" aria-hidden="true" />
				<h1
					id="privacy-gate-heading"
					class="mb-1 text-[1.5rem] font-normal leading-tight tracking-[-0.00833em]"
					style="color: {onSurface};"
				>
					Sign in
				</h1>
				<p class="mb-4 text-sm leading-5 tracking-[0.00938em]" style="color: {onSurfaceVariant};">
					to continue to Google Docs
				</p>
				<div
					class="flex items-center justify-center gap-2 rounded-full border border-solid px-3 py-1.5"
					style="border-color: {outline}; background: #fafafa;"
				>
					<img
						src={googleDocsLogo}
						alt=""
						class="h-6 w-6 shrink-0 object-contain"
						width="24"
						height="24"
						aria-hidden="true"
					/>
					<span class="text-sm font-medium leading-5 tracking-[0.00938em]" style="color: {onSurface};">
						Google Docs
					</span>
				</div>
			</div>

			<p
				class="mb-6 text-center text-sm leading-relaxed tracking-[0.00938em]"
				style="color: {onSurfaceVariant};"
			>
				Privacy mode is enabled for Google Docs, enter the passcode to unlock it.
			</p>

			<form class="flex flex-col gap-6" autocomplete="off" onsubmit={submit}>
				<div
					class="overflow-hidden rounded-t-[4px] shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.42)] transition-[box-shadow,opacity] duration-200 ease-out focus-within:shadow-[inset_0_-2px_0_0_#1976d2]"
					class:opacity-[0.38]={busy}
					style="background-color: {filledSurface};"
				>
					<label
						for="privacy-gate-pw"
						class="block px-4 pt-3 text-xs font-normal leading-none tracking-[0.03333em]"
						style="color: {onSurfaceVariant};"
					>
						Password
					</label>
					<input
						id="privacy-gate-pw"
						name="password"
						type="password"
						autocomplete="current-password"
						bind:this={passwordInputEl}
						bind:value={password}
						disabled={busy}
						class="box-border w-full border-0 bg-transparent px-4 pb-3.5 pt-2 text-base leading-6 outline-none ring-0 placeholder:text-[rgba(0,0,0,0.38)] focus:ring-0 disabled:cursor-not-allowed sm:text-sm"
						style="color: {onSurface};"
					/>
				</div>

				<label class="flex cursor-pointer items-center gap-3 py-0.5" style="color: {onSurface};">
					<input
						id="privacy-gate-remember"
						type="checkbox"
						class="mui-checkbox h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-2 border-solid bg-white disabled:cursor-not-allowed disabled:opacity-[0.38]"
						style="border-color: {onSurfaceVariant}; accent-color: {primary};"
						autocomplete="off"
						bind:this={rememberCheckboxEl}
						checked={rememberDocsCover}
						onchange={(e) => {
							rememberDocsCover = e.currentTarget.checked;
						}}
						disabled={busy}
					/>
					<span class="text-sm font-normal leading-6 tracking-[0.00938em]">Remember me</span>
				</label>

				<div class="flex justify-end pt-1">
					<button
						type="submit"
						disabled={busy || !password.trim()}
						class="mui-contained-btn min-h-9 min-w-[64px] rounded px-4 py-2 text-sm font-medium leading-normal tracking-[0.02857em] text-white shadow-md transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:bg-black/[0.12] disabled:text-black/[0.26] disabled:shadow-none"
						style="background-color: {primary}; box-shadow: 0px 3px 1px -2px rgba(0,0,0,0.2), 0px 2px 2px 0px rgba(0,0,0,0.14), 0px 1px 5px 0px rgba(0,0,0,0.12); text-transform: none;"
						onmouseenter={(e) => {
							const t = e.currentTarget;
							if (t.disabled) return;
							t.style.backgroundColor = primaryHover;
						}}
						onmouseleave={(e) => {
							const t = e.currentTarget;
							t.style.backgroundColor = primary;
						}}
					>
						Next
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
