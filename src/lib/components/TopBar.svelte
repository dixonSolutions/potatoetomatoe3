<script lang="ts">
	import { base, resolve } from '$app/paths';
	import { page } from '$app/stores';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as NavigationMenu from '$lib/components/ui/navigation-menu';
	import { Menu, Sun, Moon, MonitorSmartphone, Settings, LogOut, Lock } from 'lucide-svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { getSettingsUiContext } from '$lib/settings-ui-context';
	import logo from '$lib/assets/logo.png';
	import { isPublicSiteDeployment, isTauriApp } from '$lib/utils/offline-deployment';
	import { quitDesktopApp } from '$lib/utils/desktop-tray';
	import AppUpdateBadge from '$lib/components/AppUpdateBadge.svelte';
	import { IsTouchOnly } from '$lib/hooks/is-touch-only.svelte';

	let {
		hidden = false,
		onLock,
		privacyReady = false
	}: {
		hidden?: boolean;
		/** Locks the privacy session. Omitted where privacy mode has no meaning. */
		onLock?: () => void;
		/**
		 * Privacy mode is on and this session is unlocked — i.e. there is something to lock.
		 *
		 * Owned by `+layout.svelte`, which already tracks it reactively. Reading it here
		 * instead meant calling `isPrivacyEnabled()`/`isPrivacySessionUnlocked()`, which read
		 * a cookie and sessionStorage: not reactive, so the effect wrapping them had no
		 * dependencies and ran exactly once, at mount. With privacy mode on the app always
		 * starts *locked* behind PrivacyGate, so that one evaluation was always `false` and
		 * unlocking never re-ran it — the button could not appear at all in a normal session,
		 * and on Android the WebView never reloads to give it a second chance.
		 */
		privacyReady?: boolean;
	} = $props();

	let isOpen = $state(false);
	let showQuit = $state(false);
	let showDownloadApp = $state(false);
	/*
	 * The privacy lock is otherwise keyboard-only, which strands touch-only devices: a
	 * tablet has no way to fire the shortcut, so the session can never be locked on demand.
	 * Show the button exactly where the shortcut cannot be typed, and keep it live —
	 * `IsTouchOnly` is backed by media queries, so pairing a mouse to a tablet removes the
	 * button and unpairing brings it back without a reload.
	 */
	const touchOnly = new IsTouchOnly();

	const settingsUi = getSettingsUiContext();

	$effect(() => {
		showQuit = isTauriApp();
		showDownloadApp = isPublicSiteDeployment();
	});

	let showLock = $derived(Boolean(onLock) && privacyReady && touchOnly.current);

	async function onQuit() {
		await quitDesktopApp();
	}

	/*
	 * Appearance cycles System -> Light -> Dark. `toggleMode` only flipped light/dark, so
	 * the first tap pinned the app to a fixed mode with no way back to following the OS —
	 * which on a device in system dark mode read as "there is no appearance setting".
	 * `ModeWatcher defaultMode="system"` in +layout.svelte supplies the initial value.
	 */
	const APPEARANCE_ORDER = ['system', 'light', 'dark'] as const;
	const appearance = $derived(userPrefersMode.current ?? 'system');
	const appearanceLabel = $derived(
		appearance === 'system' ? 'System' : appearance === 'light' ? 'Light' : 'Dark'
	);

	function cycleAppearance() {
		const next = APPEARANCE_ORDER[(APPEARANCE_ORDER.indexOf(appearance) + 1) % 3];
		setMode(next);
	}

	/** Primary destinations, shared by the slide-out menu. `match` is a pathname suffix. */
	const mobileLinks = $derived([
		{ title: 'Home', href: resolve('/home'), match: '/home' },
		{ title: 'All Games', href: resolve('/games'), match: '/games' },
		{ title: 'Playtime & algorithm', href: resolve('/play-analytics'), match: 'play-analytics' },
		...(showDownloadApp
			? [{ title: 'Download app', href: resolve('/download'), match: '/download' }]
			: [])
	]);

	function isCurrent(match: string): boolean {
		const path = $page.url.pathname;
		return path === match || path.endsWith(match);
	}

	const categories = $derived([
		{
			title: 'Action Games',
			href: `${base}/games?category=action`,
			description: 'Fast-paced action and combat games'
		},
		{
			title: 'Sports Games',
			href: `${base}/games?category=sports`,
			description: 'Soccer, basketball, and more'
		},
		{
			title: 'Racing Games',
			href: `${base}/games?category=racing`,
			description: 'Cars, bikes, and high-speed thrills'
		},
		{
			title: 'Puzzle Games',
			href: `${base}/games?category=puzzle`,
			description: 'Brain teasers and logic challenges'
		},
		{
			title: 'Platformer Games',
			href: `${base}/games?category=platformer`,
			description: 'Jump, run, and explore'
		},
		{
			title: 'Shooter Games',
			href: `${base}/games?category=shooter`,
			description: 'FPS and shooting action'
		}
	]);
</script>

{#if !hidden}
	<nav
		class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
	>
		<div class="mx-auto flex h-16 w-full max-w-[1920px] items-center px-3 sm:px-5">
			<!-- Logo -->
			<a href={resolve('/home')} class="flex flex-shrink-0 items-center space-x-2">
				<img src={logo} alt="" width="32" height="32" class="h-8 w-8" />
				<span class="text-xl font-bold">Potato Tomato Games</span>
			</a>

			<!-- Desktop Navigation - Centered -->
			<div class="hidden flex-1 justify-center lg:flex">
				<NavigationMenu.Root>
					<NavigationMenu.List class="flex space-x-6">
						<NavigationMenu.Item>
							<NavigationMenu.Trigger class="font-medium hover:text-primary">
								Categories
							</NavigationMenu.Trigger>
							<NavigationMenu.Content>
								<ul class="grid w-[400px] gap-3 p-4 md:grid-cols-2">
									{#each categories as category (category.href)}
										<li>
											<NavigationMenu.Link
												href={category.href}
												class="block space-y-1 rounded-md p-3 leading-none no-underline transition-colors outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
											>
												<div class="text-sm leading-none font-medium">{category.title}</div>
												<p class="line-clamp-2 text-sm leading-snug text-muted-foreground">
													{category.description}
												</p>
											</NavigationMenu.Link>
										</li>
									{/each}
								</ul>
							</NavigationMenu.Content>
						</NavigationMenu.Item>

						<NavigationMenu.Item>
							<NavigationMenu.Link
								href={resolve('/home')}
								class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 {$page
									.url.pathname === '/home' || $page.url.pathname.endsWith('/home')
									? 'text-primary'
									: ''}"
							>
								Home
							</NavigationMenu.Link>
						</NavigationMenu.Item>

						<NavigationMenu.Item>
							<NavigationMenu.Link
								href={resolve('/play-analytics')}
								class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 {$page.url.pathname.includes(
									'play-analytics'
								)
									? 'text-primary'
									: ''}"
							>
								Analytics
							</NavigationMenu.Link>
						</NavigationMenu.Item>

						<NavigationMenu.Item>
							<NavigationMenu.Link
								href={resolve('/games')}
								class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 {$page
									.url.pathname === '/games' || $page.url.pathname.endsWith('/games')
									? 'text-primary'
									: ''}"
							>
								All Games
							</NavigationMenu.Link>
						</NavigationMenu.Item>
						{#if showDownloadApp}
							<NavigationMenu.Item>
								<NavigationMenu.Link
									href={resolve('/download')}
									class="group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 {$page.url.pathname.includes(
										'/download'
									)
										? 'text-primary'
										: ''}"
								>
									Download app
								</NavigationMenu.Link>
							</NavigationMenu.Item>
						{/if}
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<!-- Desktop Actions -->
			<div class="hidden flex-shrink-0 items-center space-x-3 lg:flex">
				<AppUpdateBadge />
				{#if showLock}
					<Button onclick={onLock} variant="outline" size="icon" aria-label="Lock now">
						<Lock class="h-[1.2rem] w-[1.2rem]" />
					</Button>
				{/if}
				{#if settingsUi}
					<Button
						onclick={() => settingsUi.openSettings()}
						variant="outline"
						size="icon"
						aria-label="Settings"
					>
						<Settings class="h-[1.2rem] w-[1.2rem]" />
					</Button>
				{/if}
				{#if showQuit}
					<Button onclick={onQuit} variant="outline" size="sm" aria-label="Quit Potato Tomato">
						<LogOut class="mr-2 h-4 w-4" />
						Quit
					</Button>
				{/if}
				<Button
					onclick={cycleAppearance}
					variant="outline"
					size="icon"
					title="Appearance: {appearanceLabel}"
				>
					{#if appearance === 'system'}
						<MonitorSmartphone class="h-[1.2rem] w-[1.2rem]" />
					{:else if appearance === 'light'}
						<Sun class="h-[1.2rem] w-[1.2rem]" />
					{:else}
						<Moon class="h-[1.2rem] w-[1.2rem]" />
					{/if}
					<span class="sr-only">Appearance: {appearanceLabel}. Activate to change.</span>
				</Button>
				<Button
					href={resolve('/games')}
					variant={$page.url.pathname.includes('/games') ? 'default' : 'outline'}
				>
					Browse all
				</Button>
			</div>

			<!-- Mobile Menu Button -->
			<div class="ml-auto flex items-center space-x-2 lg:hidden">
				<AppUpdateBadge compact />
				{#if showLock}
					<Button onclick={onLock} variant="outline" size="icon" aria-label="Lock now">
						<Lock class="h-5 w-5" />
					</Button>
				{/if}
				{#if showQuit}
					<Button onclick={onQuit} variant="outline" size="icon" aria-label="Quit Potato Tomato">
						<LogOut class="h-5 w-5" />
					</Button>
				{/if}
				{#if settingsUi}
					<Button
						onclick={() => settingsUi.openSettings()}
						variant="outline"
						size="icon"
						aria-label="Settings"
					>
						<Settings class="h-5 w-5" />
					</Button>
				{/if}
				<Button
					onclick={cycleAppearance}
					variant="outline"
					size="icon"
					title="Appearance: {appearanceLabel}"
				>
					{#if appearance === 'system'}
						<MonitorSmartphone class="h-[1.2rem] w-[1.2rem]" />
					{:else if appearance === 'light'}
						<Sun class="h-[1.2rem] w-[1.2rem]" />
					{:else}
						<Moon class="h-[1.2rem] w-[1.2rem]" />
					{/if}
					<span class="sr-only">Appearance: {appearanceLabel}. Activate to change.</span>
				</Button>
				<Sheet.Root bind:open={isOpen}>
					<Sheet.Trigger
						class="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
					>
						<Menu class="h-5 w-5" />
						<span class="sr-only">Toggle menu</span>
					</Sheet.Trigger>
					<Sheet.Content side="right" class="flex w-[86vw] max-w-[360px] flex-col gap-0 p-0">
						<div class="flex items-center gap-2 border-b px-4 py-3">
							<img src={logo} alt="" width="28" height="28" class="h-7 w-7" />
							<span class="truncate text-base font-semibold">Potato Tomato Games</span>
						</div>

						<!--
							Every row is a 44px-high full-width target. The previous menu used bare
							`text-sm` links about 20px tall, which is below the Android/WCAG minimum and
							made them genuinely hard to hit on a tablet.
						-->
						<nav class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
							{#each mobileLinks as link (link.href)}
								<a
									href={link.href}
									class="flex min-h-11 items-center rounded-md px-3 text-sm transition-colors {isCurrent(
										link.match
									)
										? 'bg-accent font-medium text-accent-foreground'
										: 'hover:bg-accent/60'}"
									onclick={() => (isOpen = false)}
								>
									{link.title}
								</a>
							{/each}

							<p class="mt-3 px-3 pb-1 text-xs font-semibold text-muted-foreground">Categories</p>
							{#each categories as category (category.href)}
								<a
									href={category.href}
									class="flex min-h-11 items-center rounded-md px-3 text-sm transition-colors hover:bg-accent/60"
									onclick={() => (isOpen = false)}
								>
									{category.title}
								</a>
							{/each}
						</nav>

						<div class="flex shrink-0 gap-2 border-t px-3 py-3">
							{#if settingsUi}
								<Button
									variant="outline"
									class="h-11 flex-1"
									onclick={() => {
										settingsUi.openSettings();
										isOpen = false;
									}}
								>
									<Settings class="mr-2 h-4 w-4" />
									Settings
								</Button>
							{/if}
							<Button href={resolve('/games')} class="h-11 flex-1" onclick={() => (isOpen = false)}>
								Play Now
							</Button>
						</div>
					</Sheet.Content>
				</Sheet.Root>
			</div>
		</div>
	</nav>
{/if}
