<script lang="ts">
	import { Download, ExternalLink, Github, Heart, Terminal } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import { resolve } from '$app/paths';

	const repositoryUrl = 'https://github.com/dixonSolutions/potatoetomatoe3';
	const releasesUrl = `${repositoryUrl}/releases`;
	const flatpakRepoUrl =
		'https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo';
	const flatpakRemoteCommand = `flatpak remote-add --user --if-not-exists --no-gpg-verify potatotomato ${flatpakRepoUrl}`;
	const flatpakInstallCommand = 'flatpak install --user potatotomato com.potatotomato.games';
</script>

<svelte:head>
	<title>Download Potato Tomato</title>
	<meta
		name="description"
		content="Install the recommended Linux Flatpak app or download the Android APK from GitHub Releases."
	/>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-10 sm:py-16">
	<section class="max-w-3xl">
		<p class="mb-3 text-sm font-semibold tracking-wide text-primary uppercase">Potato Tomato app</p>
		<h1 class="text-3xl font-bold tracking-tight sm:text-5xl">
			Keep playing with offline downloads and touch controls.
		</h1>
		<p class="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
			The browser is the preview. The native app adds the puller, verified offline mirrors, saves,
			and the full touch console.
		</p>
		<div class="mt-6 flex flex-wrap gap-3">
			<Button href={releasesUrl} target="_blank" rel="noreferrer">
				<Download class="mr-2 size-4" />
				View latest release
			</Button>
			<Button href={repositoryUrl} target="_blank" rel="noreferrer" variant="outline">
				<Github class="mr-2 size-4" />
				View on GitHub
			</Button>
		</div>
	</section>

	<div class="mt-10 grid gap-5 lg:grid-cols-2">
		<Card.Root class="border-primary/40 shadow-md">
			<Card.Header>
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-xs font-semibold tracking-wide text-primary uppercase">Recommended</p>
						<Card.Title class="mt-1 text-2xl">Linux / Flatpak</Card.Title>
					</div>
					<div class="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
						Latest stable
					</div>
				</div>
				<Card.Description>
					Add the Potato Tomato remote once, then Flatpak handles normal installs and updates.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="rounded-lg border bg-muted/40 p-3">
					<div class="mb-2 flex items-center gap-2 text-sm font-medium">
						<Terminal class="size-4 text-primary" />
						<span>Add the remote</span>
					</div>
					<code class="block overflow-x-auto text-xs leading-6">{flatpakRemoteCommand}</code>
					<Button
						variant="outline"
						size="sm"
						class="mt-3"
						onclick={() => void navigator.clipboard?.writeText(flatpakRemoteCommand)}
					>
						Copy command
					</Button>
				</div>
				<div class="rounded-lg border bg-muted/40 p-3">
					<p class="mb-2 text-sm font-medium">Install the app</p>
					<code class="block overflow-x-auto text-xs leading-6">{flatpakInstallCommand}</code>
					<Button
						variant="outline"
						size="sm"
						class="mt-3"
						onclick={() => void navigator.clipboard?.writeText(flatpakInstallCommand)}
					>
						Copy install command
					</Button>
				</div>
				<div class="flex flex-wrap gap-3">
					<Button href={`${repositoryUrl}/releases/latest`} target="_blank" rel="noreferrer">
						Install from GitHub Release
						<ExternalLink class="ml-2 size-4" />
					</Button>
					<Button href={flatpakRepoUrl} target="_blank" rel="noreferrer" variant="ghost" size="sm">
						Open .flatpakrepo
					</Button>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Manual updates
				</p>
				<Card.Title class="mt-1 text-2xl">Android APK</Card.Title>
				<Card.Description>
					Download the signed APK from the matching GitHub Release and install it manually.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
					Android does not support Flatpak remotes. APK updates must be downloaded and installed
					manually from GitHub Releases.
				</div>
				<Button
					href={`${repositoryUrl}/releases/latest`}
					target="_blank"
					rel="noreferrer"
					variant="outline"
				>
					Download Android APK
					<ExternalLink class="ml-2 size-4" />
				</Button>
			</Card.Content>
		</Card.Root>
	</div>

	<section class="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
		<p class="text-sm text-muted-foreground">
			Try games in the browser first, then choose the native experience.
		</p>
		<div class="flex flex-wrap gap-2">
			<Button href={resolve('/games')} variant="ghost" size="sm">Browse games</Button>
			<Button href={repositoryUrl} target="_blank" rel="noreferrer" variant="ghost" size="sm">
				<Github class="mr-2 size-4" />
				Contribute
			</Button>
			<Button
				href={`${repositoryUrl}/issues`}
				target="_blank"
				rel="noreferrer"
				variant="ghost"
				size="sm"
			>
				<Heart class="mr-2 size-4" />
				Report or help
			</Button>
		</div>
	</section>
</div>
