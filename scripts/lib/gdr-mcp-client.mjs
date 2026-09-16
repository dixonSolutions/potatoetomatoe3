/**
 * Tiny stdio MCP client for the GNOME desktop remote (`gdr-mcp`).
 *
 * The desktop field tests need three things from the live session: full-screen
 * captures, key chords (Super+Up to maximize, Alt+F8 for a keyboard resize) and the
 * odd click. The `gdr` CLI only taps single evdev keycodes, while the MCP server that
 * Claude Code itself talks to exposes chords, so the tests speak MCP to it directly —
 * JSON-RPC over stdio, one request at a time, nothing more.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';

export class GdrMcpClient {
	/** @param {{ command?: string, args?: string[] }} [opts] */
	constructor(opts = {}) {
		this.command = opts.command ?? process.env.GDR_MCP_COMMAND ?? 'gdr-mcp';
		this.args = opts.args ?? ['--dev', process.env.GDR_HOST ?? 'local'];
		this.nextId = 1;
		/** @type {Map<number, { resolve: Function, reject: Function }>} */
		this.pending = new Map();
		this.buffer = '';
		this.child = null;
	}

	async start() {
		this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.stdout.setEncoding('utf8');
		this.child.stdout.on('data', (chunk) => this.#onData(chunk));
		this.child.stderr.setEncoding('utf8');
		this.child.stderr.on('data', () => {});
		this.child.on('exit', (code) => {
			for (const { reject } of this.pending.values()) {
				reject(new Error(`gdr-mcp exited with code ${code}`));
			}
			this.pending.clear();
		});
		if (this.child.exitCode !== null) throw new Error('gdr-mcp failed to start');
		await this.request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'potato-tomato-field-test', version: '1' }
		});
		this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' });
	}

	#onData(chunk) {
		this.buffer += chunk;
		let index;
		while ((index = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, index).trim();
			this.buffer = this.buffer.slice(index + 1);
			if (!line) continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error)
					reject(new Error(message.error.message ?? JSON.stringify(message.error)));
				else resolve(message.result);
			}
		}
	}

	#send(message) {
		this.child.stdin.write(JSON.stringify(message) + '\n');
	}

	request(method, params, timeoutMs = 30_000) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`gdr-mcp ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				}
			});
			this.#send({ jsonrpc: '2.0', id, method, params });
		});
	}

	/**
	 * Call one tool and return its text/JSON payload (image blobs are dropped: the field
	 * test saves screenshots through the CLI, which writes straight to disk).
	 */
	async call(name, args = {}) {
		const result = await this.request('tools/call', { name, arguments: args });
		const texts = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text);
		const text = texts.join('\n');
		if (result?.isError) throw new Error(`${name}: ${text}`);
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	async hotkey(keys) {
		return this.call('gdr_hotkey', { keys });
	}

	async close() {
		if (!this.child) return;
		this.child.stdin.end();
		const exited = once(this.child, 'exit');
		setTimeout(() => this.child.kill('SIGTERM'), 500).unref();
		await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
	}
}
