import { GENERATE_GAMES_LIST_SCRIPT } from '../paths.js';
import { runRepoNodeScript } from './run-repo-script.js';

/** Regenerates games-list.json, games-metadata.json, game-entries.json (repo `scripts/generate-games-list.js`). */
export async function runGenerateGamesList(): Promise<number> {
	return runRepoNodeScript(GENERATE_GAMES_LIST_SCRIPT, []);
}
