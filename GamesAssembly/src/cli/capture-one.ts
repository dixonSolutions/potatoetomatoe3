#!/usr/bin/env node
import { mirrorGameOffline } from '../mirror-game.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const force = argv.includes('--force');
const gameId = argv.find((a) => !a.startsWith('--'));

async function main() {
	if (!gameId) {
		console.error('Usage: pnpm run offline:one -- <gameId> [--force]');
		process.exit(1);
	}
	const code = await mirrorGameOffline(gameId, { force });
	process.exit(code);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
