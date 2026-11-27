import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isNetworkOnline,
	OFFLINE_SETTLE_MS,
	ONLINE_SETTLE_MS,
	resetNetworkStatusForTests,
	subscribeNetworkStatus
} from './network-status';

describe('network status', () => {
	let target: EventTarget;
	let onLine = true;
	const flip = (v: boolean) => {
		onLine = v;
		target.dispatchEvent(new Event(v ? 'online' : 'offline'));
	};

	beforeEach(() => {
		vi.useFakeTimers();
		target = new EventTarget();
		onLine = true;
		vi.stubGlobal('window', target);
		vi.stubGlobal('navigator', {
			get onLine() {
				return onLine;
			}
		});
		resetNetworkStatusForTests();
	});
	afterEach(() => {
		resetNetworkStatusForTests();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('ignores a flapping connection and reports a settled drop once', () => {
		const heard: boolean[] = [];
		subscribeNetworkStatus((o) => heard.push(o));
		for (let i = 0; i < 5; i++) {
			flip(false);
			vi.advanceTimersByTime(200);
			flip(true);
			vi.advanceTimersByTime(200);
		}
		expect(heard).toEqual([]);
		flip(false);
		vi.advanceTimersByTime(OFFLINE_SETTLE_MS - 1);
		expect(heard).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(heard).toEqual([false]);
		expect(isNetworkOnline()).toBe(false);
		flip(false);
		vi.advanceTimersByTime(OFFLINE_SETTLE_MS * 2);
		expect(heard).toEqual([false]);
		flip(true);
		vi.advanceTimersByTime(ONLINE_SETTLE_MS);
		expect(heard).toEqual([false, true]);
	});

	it('shares one listener between subscribers and stops when the last leaves', () => {
		const add = vi.spyOn(target, 'addEventListener');
		const a = vi.fn();
		const b = vi.fn();
		const offA = subscribeNetworkStatus(a);
		const offB = subscribeNetworkStatus(b);
		expect(add).toHaveBeenCalledTimes(2);
		flip(false);
		vi.advanceTimersByTime(OFFLINE_SETTLE_MS);
		expect(a).toHaveBeenCalledOnce();
		expect(b).toHaveBeenCalledOnce();
		offA();
		offB();
		flip(true);
		vi.advanceTimersByTime(ONLINE_SETTLE_MS);
		expect(a).toHaveBeenCalledOnce();
	});
});
