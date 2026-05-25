import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { base } from '$app/paths';

/** `/` always sends users to the personalized feed at `/home`. */
export const load: PageServerLoad = async () => {
	throw redirect(302, `${base}/home`);
};
