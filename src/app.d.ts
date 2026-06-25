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

export {};
