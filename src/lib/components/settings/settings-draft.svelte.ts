import { changedFields, snapshotFields } from './settings-draft';

/**
 * Edits a section holds until Save. `value` is replaced, never mutated, so update it
 * with `set` / `patch`; `pending` counts the fields that differ from what is stored.
 */
export class SettingsDraftState<T extends Record<string, unknown>> {
	value = $state.raw() as T;
	#baseline = $state.raw() as Record<keyof T, string>;
	#load: () => T;

	readonly pending = $derived.by(() => changedFields(this.value, this.#baseline).length);

	constructor(load: () => T) {
		this.#load = load;
		this.value = load();
		this.#baseline = snapshotFields(this.value);
	}

	set<K extends keyof T>(key: K, next: T[K]): void {
		this.value = { ...this.value, [key]: next };
	}

	patch(next: Partial<T>): void {
		this.value = { ...this.value, ...next };
	}

	changed(key: keyof T): boolean {
		return changedFields(this.value, this.#baseline).includes(key);
	}

	/** Reload from storage, dropping every edit. */
	reset(): void {
		this.value = this.#load();
		this.#baseline = snapshotFields(this.value);
	}

	/** The current edits are now what is stored. */
	commit(): void {
		this.#baseline = snapshotFields(this.value);
	}

	/**
	 * Some fields were stored on their own (a switch that applies at once): take them into
	 * both the draft and the baseline, leaving the other unsaved edits as they are.
	 */
	commitFields(saved: Partial<T>): void {
		this.value = { ...this.value, ...saved };
		this.#baseline = { ...this.#baseline, ...snapshotFields(saved as T) };
	}
}
