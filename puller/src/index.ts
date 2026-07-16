import { startServer } from './server.js';
import { seedBundledOfflineFromCatalog } from './catalog.js';

async function main(): Promise<void> {
	await seedBundledOfflineFromCatalog();
	startServer();
}

main().catch((error: unknown) => {
	console.error('[puller] startup failed:', error);
	process.exitCode = 1;
});
