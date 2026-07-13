// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
		/** Augment so tooling picks up `+layout.server.ts` fields before sync regenerates ambient types. */
		interface LayoutData {
			ssrPrivacyHead: {
				privacyModeEnabled: boolean;
				decoyTitle: string | null;
				decoyFavicon: string | null;
				privacySessionUnlocked: boolean;
			};
		}
	}
}

interface ImportMetaEnv {
	readonly PUBLIC_PLAY_PROXY_URL?: string;
	readonly PUBLIC_DOWNLOADER_URL?: string;
	readonly PUBLIC_OFFLINE_DEPLOYMENT?: string;
	readonly PUBLIC_PAGES_BASE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
