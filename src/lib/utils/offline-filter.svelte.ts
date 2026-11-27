/**
 * The Offline filter: with no internet, show only downloaded games (on by default). Turned
 * off, Home and Games show everything and just say "Offline". Remembered per device.
 */
const KEY = 'potato-tomato-offline-filter';

function read(): boolean {
	try {
		return typeof localStorage === 'undefined' || localStorage.getItem(KEY) !== 'off';
	} catch {
		return true;
	}
}

const filter = $state({ on: read() });

export function offlineFilterOn(): boolean {
	return filter.on;
}

export function setOfflineFilter(on: boolean): void {
	filter.on = on;
	try {
		localStorage.setItem(KEY, on ? 'on' : 'off');
	} catch {
		/* memory only */
	}
}
