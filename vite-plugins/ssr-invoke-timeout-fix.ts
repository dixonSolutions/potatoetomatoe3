import type { Plugin } from 'vite';

const RUNNER_KEY = '_ssrCompatModuleRunner' as const;

function patchSsrRunnerTransport(runner: { options?: { transport?: { timeout?: number } } } | undefined) {
	const t = runner?.options?.transport;
	if (!t || t.timeout != null) return;
	// Vite 7 module runner defaults fetchModule RPC to 60s; Tailwind v4 first compile often exceeds that.
	// 0 = disable invoke timeout (see vite/dist/node/module-runner.js createInvokeableTransport).
	t.timeout = 0;
}

/**
 * Prevents "transport invoke timed out after 60000ms" when SSR first-loads heavy CSS (e.g. Tailwind v4).
 */
export function ssrInvokeTimeoutFix(): Plugin {
	return {
		name: 'ssr-invoke-timeout-fix',
		enforce: 'pre',
		configureServer(server) {
			const serverRec = server as unknown as Record<string, unknown>;
			if (serverRec[RUNNER_KEY]) {
				patchSsrRunnerTransport(serverRec[RUNNER_KEY] as Parameters<typeof patchSsrRunnerTransport>[0]);
			}
			let runner: unknown;
			Object.defineProperty(server, RUNNER_KEY, {
				enumerable: true,
				configurable: true,
				get() {
					return runner;
				},
				set(value: unknown) {
					runner = value;
					patchSsrRunnerTransport(value as Parameters<typeof patchSsrRunnerTransport>[0]);
				}
			});
		}
	};
}
