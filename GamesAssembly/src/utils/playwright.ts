/**
 * Shared Playwright / Chromium defaults for GamesAssembly (CDP capture, smoke tests, etc.).
 */
import { chromium, type Browser } from 'playwright';

export const DEFAULT_PLAYWRIGHT_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function getChromiumExecutablePath(): string | undefined {
	const p = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	return p && p.trim() ? p.trim() : undefined;
}

export type LaunchChromiumOptions = {
	headless?: boolean;
};

/** Launches Chromium with optional custom executable (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH). */
export async function launchChromium(options: LaunchChromiumOptions = {}): Promise<Browser> {
	const { headless = true } = options;
	const executablePath = getChromiumExecutablePath();
	return chromium.launch({
		headless,
		...(executablePath ? { executablePath } : {})
	});
}
