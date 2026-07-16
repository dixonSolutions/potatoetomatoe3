import { describe, expect, it } from 'vitest';
import {
	isAllowedKeyCode,
	parseConsoleCommand,
	parsePullerCommand
} from './commands';

describe('harness commands', () => {
	it('parses allowlisted console commands', () => {
		expect(parseConsoleCommand('tap Space')).toEqual({
			name: 'tap',
			args: ['Space']
		});
		expect(parseConsoleCommand('joystick 0 -0.5')).toEqual({
			name: 'joystick',
			args: ['0', '-0.5']
		});
		expect(parseConsoleCommand('releaseAll')).toEqual({
			name: 'releaseAll',
			args: []
		});
	});

	it('rejects unknown or unsafe console input', () => {
		expect(parseConsoleCommand('eval alert(1)')).toMatchObject({ error: expect.any(String) });
		expect(parseConsoleCommand('down FakeKey')).toMatchObject({ error: expect.any(String) });
		expect(parseConsoleCommand('joystick 2 0')).toMatchObject({ error: expect.any(String) });
		expect(isAllowedKeyCode('KeyW')).toBe(true);
		expect(isAllowedKeyCode('__proto__')).toBe(false);
	});

	it('parses allowlisted puller commands', () => {
		expect(parsePullerCommand('download')).toEqual({ name: 'download', args: [] });
		expect(parsePullerCommand('playOnline')).toEqual({ name: 'playOnline', args: [] });
		expect(parsePullerCommand('curl http://evil')).toMatchObject({ error: expect.any(String) });
	});
});
