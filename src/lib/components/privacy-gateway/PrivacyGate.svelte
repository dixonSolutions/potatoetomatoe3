<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		verifyAndUnlock,
		getPrivacyDisguiseProvider,
		getPrivacyDisguiseServiceId
	} from '$lib/utils/privacy-mode';
	import {
		getProviderTheme,
		resolveDisguiseService
	} from '$lib/utils/privacy-disguise-registry';
	import { toast } from 'svelte-sonner';

	let { onUnlocked }: { onUnlocked: () => void } = $props();

	const provider = $derived(getPrivacyDisguiseProvider());
	const service = $derived(resolveDisguiseService(provider, getPrivacyDisguiseServiceId()));
	const theme = $derived(getProviderTheme(provider));
	const isMicrosoft = $derived(provider === 'microsoft');

	let password = $state('');
	let busy = $state(false);
	let passwordInputEl = $state<HTMLInputElement | null>(null);
	let rememberCheckboxEl = $state<HTMLInputElement | null>(null);
	let rememberCover = $state(false);

	function resetRememberMeToUnchecked() {
		rememberCover = false;
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
		const redirectToCover = rememberCheckboxEl?.checked === true;
		busy = true;
		try {
			const ok = await verifyAndUnlock(password);
			if (ok) {
				password = '';
				if (redirectToCover) {
					window.location.replace(service.rememberRedirect);
					return;
				}
				toast.success(isMicrosoft ? 'Signed in' : 'Signed in');
				onUnlocked();
			} else {
				toast.error(isMicrosoft ? "We couldn't sign you in" : "Couldn't sign in");
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	{#if theme.fontStylesheet}
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
		<link href={theme.fontStylesheet} rel="stylesheet" />
	{/if}
</svelte:head>

<div
	class="privacy-gate-root fixed inset-0 z-[9999] isolate flex min-h-screen flex-col [color-scheme:light]"
	style="font-family: {theme.fontFamily}; background-color: {theme.pageBackground};"
	role="region"
	aria-labelledby="privacy-gate-heading"
>
	<div class="flex min-h-screen flex-col items-center justify-center p-6 sm:p-8">
		<div
			class="w-full overflow-hidden rounded px-6 py-10 sm:px-10 sm:py-12"
			style="max-width: {theme.cardMaxWidth}; background: {theme.cardBackground}; box-shadow: {theme.cardShadow}; border: {theme.cardBorder};"
		>
			<div
				class="mb-8 flex flex-col text-center"
				class:items-center={!isMicrosoft}
				class:items-start={isMicrosoft}
			>
				{#if isMicrosoft}
					<div class="mb-6 flex w-full items-center gap-3">
						<img
							src={theme.providerLogo}
							alt=""
							width={theme.providerLogoSize.w}
							height={theme.providerLogoSize.h}
							class="shrink-0"
							aria-hidden="true"
						/>
						<span class="text-sm font-semibold" style="color: {theme.onSurface};">Microsoft</span>
					</div>
				{:else}
					<img
						src={theme.providerLogo}
						alt=""
						class="mb-6 h-12 w-12"
						width={theme.providerLogoSize.w}
						height={theme.providerLogoSize.h}
						aria-hidden="true"
					/>
				{/if}
				<h1
					id="privacy-gate-heading"
					class="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.00833em]"
					class:font-normal={!isMicrosoft}
					style="color: {theme.onSurface};"
				>
					{theme.signInHeading}
				</h1>
				<p
					class="mb-4 text-sm leading-5"
					class:tracking-[0.00938em]={!isMicrosoft}
					style="color: {theme.onSurfaceVariant};"
				>
					{theme.continueTo(service.label)}
				</p>
				<div
					class="flex items-center justify-center gap-2 rounded-full border border-solid px-3 py-1.5"
					class:mx-auto={isMicrosoft}
					style="border-color: {theme.outline}; background: {theme.pageBackground};"
				>
					<img
						src={service.serviceIcon}
						alt=""
						class="h-6 w-6 shrink-0 object-contain"
						width="24"
						height="24"
						aria-hidden="true"
					/>
					<span
						class="text-sm font-medium leading-5"
						class:tracking-[0.00938em]={!isMicrosoft}
						style="color: {theme.onSurface};"
					>
						{service.label}
					</span>
				</div>
			</div>

			<p
				class="mb-6 text-center text-sm leading-relaxed"
				class:tracking-[0.00938em]={!isMicrosoft}
				style="color: {theme.onSurfaceVariant};"
			>
				{theme.privacyCopy(service.label)}
			</p>

			<form class="flex flex-col gap-6" autocomplete="off" onsubmit={submit}>
				<div
					class="overflow-hidden transition-[box-shadow,opacity,border-color] duration-200 ease-out focus-within:shadow-[inset_0_-2px_0_0_var(--pg-primary)]"
					class:rounded-t-[4px]={!isMicrosoft}
					class:shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.42)]={!isMicrosoft}
					class:rounded-md={isMicrosoft}
					class:border={isMicrosoft}
					class:opacity-[0.38]={busy}
					style="--pg-primary: {theme.primary}; background-color: {theme.filledSurface}; border-color: {isMicrosoft ? theme.outline : 'transparent'};"
				>
					<label
						for="privacy-gate-pw"
						class="block px-4 pt-3 text-xs font-normal leading-none"
						class:tracking-[0.03333em]={!isMicrosoft}
						style="color: {theme.onSurfaceVariant};"
					>
						{isMicrosoft ? 'Password' : 'Password'}
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
						style="color: {theme.onSurface};"
					/>
				</div>

				<label class="flex cursor-pointer items-center gap-3 py-0.5" style="color: {theme.onSurface};">
					<input
						id="privacy-gate-remember"
						type="checkbox"
						class="h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-2 border-solid bg-white disabled:cursor-not-allowed disabled:opacity-[0.38]"
						style="border-color: {theme.onSurfaceVariant}; accent-color: {theme.primary};"
						autocomplete="off"
						bind:this={rememberCheckboxEl}
						checked={rememberCover}
						onchange={(e) => {
							rememberCover = e.currentTarget.checked;
						}}
						disabled={busy}
					/>
					<span class="text-sm font-normal leading-6" class:tracking-[0.00938em]={!isMicrosoft}>
						{theme.rememberMeLabel}
					</span>
				</label>

				<div class="flex justify-end pt-1">
					<button
						type="submit"
						disabled={busy || !password.trim()}
						class="min-h-9 min-w-[64px] rounded-full px-6 py-2 text-sm font-medium leading-normal text-white transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:text-black/[0.26] disabled:shadow-none"
						class:tracking-[0.02857em]={!isMicrosoft}
						style="background-color: {busy || !password.trim() ? theme.primaryDisabled : theme.primary}; text-transform: none;"
						onmouseenter={(e) => {
							const t = e.currentTarget;
							if (t.disabled) return;
							t.style.backgroundColor = theme.primaryHover;
						}}
						onmouseleave={(e) => {
							const t = e.currentTarget;
							if (t.disabled) {
								t.style.backgroundColor = theme.primaryDisabled;
								return;
							}
							t.style.backgroundColor = theme.primary;
						}}
					>
						{theme.submitLabel}
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
