// Dump chrome://gpu from the bench Chromium (headed, Wayland, private compositor).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
// Playwright comes from the puller package (repo root = four levels up from harness/).
const require = createRequire(new URL('../../../../puller/package.json', import.meta.url));
const { chromium } = require('playwright');
const out = process.argv[2];
const extra = process.argv.slice(3);
const b = await chromium.launch({
	headless: false,
	executablePath:
		process.env.CHROME ??
		process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
	args: ['--ozone-platform=wayland', ...extra],
	ignoreDefaultArgs: ['--disable-gpu', '--enable-unsafe-swiftshader']
});
const p = await b.newPage();
await p.goto('chrome://gpu');
await p.waitForTimeout(3000);
const text = await p.evaluate(() => {
	const root = document.querySelector('info-view')?.shadowRoot ?? document;
	return root.body ? root.body.innerText : root.textContent;
});
writeFileSync(out, text);
console.log(text.split('\n').slice(0, 60).join('\n'));
await b.close();
