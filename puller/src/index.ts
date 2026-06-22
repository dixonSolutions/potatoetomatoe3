import { startServer } from './server.js';
import { seedBundledOfflineFromCatalog } from './catalog.js';

await seedBundledOfflineFromCatalog();
startServer();
