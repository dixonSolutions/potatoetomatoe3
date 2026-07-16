import { describe, expect, it } from 'vitest';
import { createAckId, isTouchInputAck, TOUCH_INPUT_ACK_TYPE } from './dispatch-ack';

describe('dispatch ack', () => {
	it('creates unique ack ids', () => {
		const a = createAckId();
		const b = createAckId();
		expect(a).not.toBe(b);
		expect(a.startsWith('ack-')).toBe(true);
	});

	it('validates bridge ack messages', () => {
		expect(
			isTouchInputAck({
				type: TOUCH_INPUT_ACK_TYPE,
				ackId: 'ack-1',
				action: 'down',
				codes: ['Space'],
				path: 'bridge',
				ok: true
			})
		).toBe(true);
		expect(isTouchInputAck({ type: 'other' })).toBe(false);
		expect(
			isTouchInputAck({
				type: TOUCH_INPUT_ACK_TYPE,
				ackId: 'ack-1',
				action: 'explode',
				codes: [],
				path: 'bridge',
				ok: true
			})
		).toBe(false);
	});
});
