/**
 * User preferences stored in localStorage
 */

export interface GamePreferences {
	liked: string[]; // game IDs
	disliked: string[]; // game IDs
}

const STORAGE_KEY = 'potato-tomato-preferences';

export function getPreferences(): GamePreferences {
	if (typeof localStorage === 'undefined') {
		return { liked: [], disliked: [] };
	}
	
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			return JSON.parse(stored);
		}
	} catch (error) {
		console.error('Failed to load preferences:', error);
	}
	
	return { liked: [], disliked: [] };
}

export function savePreferences(prefs: GamePreferences): void {
	if (typeof localStorage === 'undefined') return;
	
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch (error) {
		console.error('Failed to save preferences:', error);
	}
}

export function likeGame(gameId: string): void {
	const prefs = getPreferences();
	
	// Remove from disliked if present
	prefs.disliked = prefs.disliked.filter(id => id !== gameId);
	
	// Add to liked if not already there
	if (!prefs.liked.includes(gameId)) {
		prefs.liked.push(gameId);
	}
	
	savePreferences(prefs);
}

export function dislikeGame(gameId: string): void {
	const prefs = getPreferences();
	
	// Remove from liked if present
	prefs.liked = prefs.liked.filter(id => id !== gameId);
	
	// Add to disliked if not already there
	if (!prefs.disliked.includes(gameId)) {
		prefs.disliked.push(gameId);
	}
	
	savePreferences(prefs);
}

export function removePreference(gameId: string): void {
	const prefs = getPreferences();
	prefs.liked = prefs.liked.filter(id => id !== gameId);
	prefs.disliked = prefs.disliked.filter(id => id !== gameId);
	savePreferences(prefs);
}

export function getGamePreference(gameId: string): 'liked' | 'disliked' | null {
	const prefs = getPreferences();
	if (prefs.liked.includes(gameId)) return 'liked';
	if (prefs.disliked.includes(gameId)) return 'disliked';
	return null;
}
