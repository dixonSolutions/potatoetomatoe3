#!/usr/bin/env node

/**
 * Script to convert iframe-based games to fully offline-playable versions
 * Downloads all assets from the iframe source and localizes them
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { JSDOM } = require('jsdom');

const GAMES_ROOT = path.join(__dirname, '../static/games');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Track downloaded files to avoid duplicates
const downloadedFiles = new Map();

/**
 * Fetch a URL and return the content
 */
async function fetchUrl(url, options = {}) {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const client = urlObj.protocol === 'https:' ? https : http;
		
		const requestOptions = {
			headers: {
				'User-Agent': USER_AGENT,
				'Accept': '*/*',
				'Accept-Encoding': 'gzip, deflate, br',
				...options.headers
			}
		};

		client.get(url, requestOptions, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
			}

			if (res.statusCode !== 200) {
				reject(new Error(`HTTP ${res.statusCode} for ${url}`));
				return;
			}

			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				const buffer = Buffer.concat(chunks);
				resolve({
					buffer,
					contentType: res.headers['content-type'] || '',
					text: () => buffer.toString('utf-8')
				});
			});
			res.on('error', reject);
		}).on('error', reject);
	});
}

/**
 * Get file extension from URL or content type
 */
function getExtension(url, contentType) {
	const urlPath = new URL(url).pathname;
	const ext = path.extname(urlPath);
	if (ext) return ext;

	// Guess from content type
	const typeMap = {
		'text/html': '.html',
		'text/css': '.css',
		'text/javascript': '.js',
		'application/javascript': '.js',
		'application/json': '.json',
		'image/png': '.png',
		'image/jpeg': '.jpg',
		'image/gif': '.gif',
		'image/svg+xml': '.svg',
		'image/webp': '.webp',
		'audio/mpeg': '.mp3',
		'audio/ogg': '.ogg',
		'audio/wav': '.wav',
		'font/woff': '.woff',
		'font/woff2': '.woff2',
		'font/ttf': '.ttf',
		'application/wasm': '.wasm'
	};

	for (const [type, extension] of Object.entries(typeMap)) {
		if (contentType.includes(type)) return extension;
	}

	return '';
}

/**
 * Sanitize filename
 */
function sanitizeFilename(filename) {
	return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Download a file and save it locally
 */
async function downloadFile(url, baseUrl, gameDir, subDir = '') {
	try {
		// Check if already downloaded
		if (downloadedFiles.has(url)) {
			return downloadedFiles.get(url);
		}

		console.log(`  Downloading: ${url}`);
		const response = await fetchUrl(url);
		
		// Determine filename
		const urlObj = new URL(url);
		let filename = path.basename(urlObj.pathname) || 'index';
		
		if (!path.extname(filename)) {
			filename += getExtension(url, response.contentType);
		}
		
		filename = sanitizeFilename(filename);
		
		// Create subdirectory if needed
		const targetDir = path.join(gameDir, subDir);
		await fs.mkdir(targetDir, { recursive: true });
		
		const filePath = path.join(targetDir, filename);
		const relativePath = path.join(subDir, filename);
		
		// Save file
		await fs.writeFile(filePath, response.buffer);
		
		downloadedFiles.set(url, relativePath);
		return relativePath;
	} catch (error) {
		console.error(`  Failed to download ${url}:`, error.message);
		return null;
	}
}

/**
 * Process HTML and download all assets
 */
async function processHtml(html, baseUrl, gameDir) {
	const dom = new JSDOM(html);
	const document = dom.window.document;
	
	// Download and replace script sources
	const scripts = document.querySelectorAll('script[src]');
	for (const script of scripts) {
		const src = script.getAttribute('src');
		if (src && !src.startsWith('data:')) {
			const absoluteUrl = new URL(src, baseUrl).href;
			const localPath = await downloadFile(absoluteUrl, baseUrl, gameDir, 'js');
			if (localPath) {
				script.setAttribute('src', localPath);
			}
		}
	}
	
	// Download and replace stylesheets
	const links = document.querySelectorAll('link[rel="stylesheet"]');
	for (const link of links) {
		const href = link.getAttribute('href');
		if (href && !href.startsWith('data:')) {
			const absoluteUrl = new URL(href, baseUrl).href;
			const localPath = await downloadFile(absoluteUrl, baseUrl, gameDir, 'css');
			if (localPath) {
				link.setAttribute('href', localPath);
				
				// Process CSS for additional assets
				try {
					const cssContent = await fs.readFile(path.join(gameDir, localPath), 'utf-8');
					const processedCss = await processCss(cssContent, absoluteUrl, gameDir);
					await fs.writeFile(path.join(gameDir, localPath), processedCss);
				} catch (error) {
					console.error(`  Failed to process CSS ${localPath}:`, error.message);
				}
			}
		}
	}
	
	// Download and replace images
	const images = document.querySelectorAll('img[src]');
	for (const img of images) {
		const src = img.getAttribute('src');
		if (src && !src.startsWith('data:')) {
			const absoluteUrl = new URL(src, baseUrl).href;
			const localPath = await downloadFile(absoluteUrl, baseUrl, gameDir, 'images');
			if (localPath) {
				img.setAttribute('src', localPath);
			}
		}
	}
	
	// Download favicon
	const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
	if (favicon) {
		const href = favicon.getAttribute('href');
		if (href && !href.startsWith('data:')) {
			const absoluteUrl = new URL(href, baseUrl).href;
			const localPath = await downloadFile(absoluteUrl, baseUrl, gameDir, 'images');
			if (localPath) {
				favicon.setAttribute('href', localPath);
			}
		}
	}
	
	return dom.serialize();
}

/**
 * Process CSS and download referenced assets
 */
async function processCss(css, baseUrl, gameDir) {
	// Match url() in CSS
	const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/g;
	let match;
	const replacements = [];
	
	while ((match = urlRegex.exec(css)) !== null) {
		const url = match[1];
		if (!url.startsWith('data:') && !url.startsWith('#')) {
			try {
				const absoluteUrl = new URL(url, baseUrl).href;
				const localPath = await downloadFile(absoluteUrl, baseUrl, gameDir, 'assets');
				if (localPath) {
					replacements.push({ original: match[0], replacement: `url('${localPath}')` });
				}
			} catch (error) {
				console.error(`  Failed to process CSS url ${url}:`, error.message);
			}
		}
	}
	
	// Apply replacements
	let processedCss = css;
	for (const { original, replacement } of replacements) {
		processedCss = processedCss.replace(original, replacement);
	}
	
	return processedCss;
}

/**
 * Localize a single game
 */
async function localizeGame(gameId) {
	const gameDir = path.join(GAMES_ROOT, gameId, 'online');
	const indexPath = path.join(gameDir, 'index.html');
	
	try {
		// Read current index.html
		const indexContent = await fs.readFile(indexPath, 'utf-8');
		
		// Check if it's an iframe wrapper
		const iframeMatch = indexContent.match(/src=["']([^"']+)["']/);
		if (!iframeMatch) {
			console.log(`⏭️  ${gameId}: Not an iframe game, skipping`);
			return { success: false, reason: 'not-iframe' };
		}
		
		const iframeUrl = iframeMatch[1];
		console.log(`🎮 Processing ${gameId}`);
		console.log(`  Iframe URL: ${iframeUrl}`);
		
		// Clear download cache for this game
		downloadedFiles.clear();
		
		// Fetch the iframe content
		const response = await fetchUrl(iframeUrl);
		const html = response.text();
		
		// Process HTML and download assets
		const processedHtml = await processHtml(html, iframeUrl, gameDir);
		
		// Backup original
		await fs.writeFile(path.join(gameDir, 'index.html.iframe-backup'), indexContent);
		
		// Write new index.html
		await fs.writeFile(indexPath, processedHtml);
		
		console.log(`✅ ${gameId}: Successfully localized (${downloadedFiles.size} files)`);
		return { success: true, filesDownloaded: downloadedFiles.size };
		
	} catch (error) {
		console.error(`❌ ${gameId}: Failed -`, error.message);
		return { success: false, reason: error.message };
	}
}

/**
 * Main function
 */
async function main() {
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.log('Usage: node localize-iframe-games.js <game-id> [game-id...]');
		console.log('   or: node localize-iframe-games.js --all');
		console.log('   or: node localize-iframe-games.js --scan');
		console.log('\nExamples:');
		console.log('  node localize-iframe-games.js 1v1-lol');
		console.log('  node localize-iframe-games.js slope 2048 among-us');
		console.log('  node localize-iframe-games.js --all');
		process.exit(1);
	}
	
	let gameIds = [];
	
	if (args[0] === '--all') {
		// Process all games
		const entries = await fs.readdir(GAMES_ROOT, { withFileTypes: true });
		gameIds = entries
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
			.map(entry => entry.name);
		console.log(`Found ${gameIds.length} games to process\n`);
	} else if (args[0] === '--scan') {
		// Scan for iframe games
		const entries = await fs.readdir(GAMES_ROOT, { withFileTypes: true });
		const allGames = entries
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
			.map(entry => entry.name);
		
		console.log('Scanning for iframe games...\n');
		const iframeGames = [];
		
		for (const gameId of allGames) {
			const indexPath = path.join(GAMES_ROOT, gameId, 'online', 'index.html');
			try {
				const content = await fs.readFile(indexPath, 'utf-8');
				if (content.includes('<iframe') && content.includes('abinbins.github.io')) {
					iframeGames.push(gameId);
				}
			} catch (error) {
				// Skip if can't read
			}
		}
		
		console.log(`Found ${iframeGames.length} iframe games:`);
		iframeGames.forEach(id => console.log(`  - ${id}`));
		console.log(`\nTo localize all: node localize-iframe-games.js ${iframeGames.join(' ')}`);
		return;
	} else {
		gameIds = args;
	}
	
	const results = {
		success: 0,
		failed: 0,
		skipped: 0
	};
	
	for (const gameId of gameIds) {
		const result = await localizeGame(gameId);
		if (result.success) {
			results.success++;
		} else if (result.reason === 'not-iframe') {
			results.skipped++;
		} else {
			results.failed++;
		}
		console.log(''); // Empty line between games
	}
	
	console.log('='.repeat(50));
	console.log(`Summary: ${results.success} succeeded, ${results.failed} failed, ${results.skipped} skipped`);
}

main().catch(console.error);
