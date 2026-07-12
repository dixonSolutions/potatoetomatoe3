export const GAME_IMMERSIVE_CHANGED = 'potato-tomato-game-immersive';

export function setGameImmersive(immersive: boolean): void {
	if (typeof window === 'undefined') return;
	document.documentElement.toggleAttribute('data-game-immersive', immersive);
	window.dispatchEvent(new CustomEvent(GAME_IMMERSIVE_CHANGED, { detail: { immersive } }));
}
