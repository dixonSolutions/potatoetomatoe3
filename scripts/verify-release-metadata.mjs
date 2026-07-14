import fs from 'node:fs';

const expectedVersion = process.argv[2];
const expectedSha = process.argv[3];

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? '')) {
	throw new Error(`Expected semantic release version, got ${expectedVersion ?? '<missing>'}`);
}
if (!/^[a-f0-9]{40}$/i.test(expectedSha ?? '')) {
	throw new Error(`Expected full commit SHA, got ${expectedSha ?? '<missing>'}`);
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');

if (packageJson.version !== expectedVersion) {
	throw new Error(`package.json version ${packageJson.version} does not match ${expectedVersion}`);
}
if (tauriConfig.version !== expectedVersion) {
	throw new Error(
		`tauri.conf.json version ${tauriConfig.version} does not match ${expectedVersion}`
	);
}
if (!new RegExp(`^version = "${expectedVersion.replaceAll('.', '\\.')}"$`, 'm').test(cargo)) {
	throw new Error(`Cargo.toml version does not match ${expectedVersion}`);
}

fs.writeFileSync(
	'version.txt',
	JSON.stringify(
		{ version: expectedVersion, tag: `v${expectedVersion}`, commit: expectedSha },
		null,
		2
	) + '\n'
);
console.log(`Release metadata verified: v${expectedVersion} @ ${expectedSha}`);
