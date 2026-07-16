import { error } from '@sveltejs/kit';
import { isDevHarnessRouteAllowed } from '$lib/dev-harness/harness-guard';
import type { LayoutLoad } from './$types';

export const prerender = false;
export const ssr = false;

export const load: LayoutLoad = () => {
	if (!isDevHarnessRouteAllowed()) {
		error(404, 'Not found');
	}
	return {};
};
