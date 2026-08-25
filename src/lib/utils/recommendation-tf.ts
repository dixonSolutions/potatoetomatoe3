/**
 * TensorFlow.js batch scoring with WebGPU when available (falls back to WebGL, then CPU).
 * Used only for client-side recommendation ranking; weights/features are built from local analytics.
 */

import type * as tfTypes from '@tensorflow/tfjs';

let backendName: string | null = null;
let initPromise: Promise<string> | null = null;

export function getRecommendationBackendName(): string | null {
	return backendName;
}

export async function initRecommendationBackend(): Promise<string> {
	if (typeof window === 'undefined') return 'ssr-skip';
	if (initPromise) return initPromise;

	initPromise = (async () => {
		const tf = (await import('@tensorflow/tfjs')) as typeof tfTypes;
		try {
			await import('@tensorflow/tfjs-backend-webgpu');
		} catch {
			/* WebGPU backend optional on some environments */
		}

		const tryBackend = async (name: string): Promise<boolean> => {
			try {
				await tf.setBackend(name);
				await tf.ready();
				return tf.getBackend() === name;
			} catch {
				return false;
			}
		};

		for (const name of ['webgpu', 'webgl', 'cpu'] as const) {
			if (await tryBackend(name)) {
				backendName = name;
				return backendName;
			}
		}

		backendName = 'cpu';
		return backendName;
	})();

	return initPromise;
}

/** Same math as TF path, for SSR or when TF fails to load. */
export function cpuMatMulVec(
	features: Float32Array,
	weights: Float32Array,
	n: number,
	f: number
): Float32Array {
	const scores = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let s = 0;
		const row = i * f;
		for (let j = 0; j < f; j++) {
			s += features[row + j] * weights[j];
		}
		scores[i] = s;
	}
	return scores;
}

/**
 * Below this many multiply-accumulates, a GPU round trip costs far more than the
 * arithmetic. Recommendation scoring is capped at 800 candidates x 8 features = 6,400
 * MACs — microseconds in plain JS. Sending that to TensorFlow meant loading the whole
 * tfjs runtime plus the WebGPU backend and then blocking on a GPU readback, which on a
 * low-end Android tablet is a visible freeze. WebGPU itself warns about it:
 *
 *   The performance of synchronously reading data from GPU to CPU is poor on the
 *   webgpu backend, please use asynchronous APIs instead.
 *
 * The threshold is set well above any size this app produces, so the GPU path stays
 * available for a future bulk workload without being on today's critical path.
 */
const GPU_WORTHWHILE_MACS = 2_000_000;

/**
 * scores[i] = sum_j features[i,j] * weights[j]
 */
export async function scoreWithTensorFlow(
	features: Float32Array,
	weights: Float32Array,
	n: number,
	f: number
): Promise<Float32Array> {
	if (n <= 0 || f <= 0) return new Float32Array(0);
	if (typeof window === 'undefined' || n * f < GPU_WORTHWHILE_MACS) {
		return cpuMatMulVec(features, weights, n, f);
	}

	try {
		await initRecommendationBackend();
		const tf = (await import('@tensorflow/tfjs')) as typeof tfTypes;

		const x = tf.tensor2d(features, [n, f]);
		const w = tf.tensor2d(weights, [f, 1]);
		const s = tf.matMul(x, w);
		try {
			/* `data()` yields to the GPU; `dataSync()` stalls the main thread until it drains. */
			return new Float32Array(await s.data());
		} finally {
			x.dispose();
			w.dispose();
			s.dispose();
		}
	} catch (e) {
		console.warn('TensorFlow scoring failed, using CPU fallback:', e);
		return cpuMatMulVec(features, weights, n, f);
	}
}
