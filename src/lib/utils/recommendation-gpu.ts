/**
 * Catalog scoring on WebGPU: one compute dispatch computes `scores = X · w` for every game
 * (X is n × FEATURE_DIM). The feature matrix is uploaded once per catalog and kept on the
 * GPU; each ranking only writes the 64-float user vector and reads back n floats.
 *
 * Falls back to the CPU loop whenever WebGPU is missing, fails, or the catalog is too small
 * for a dispatch to beat it. No library: this replaces TensorFlow.js, which cost a large
 * download for a single mat-vec.
 */
import { FEATURE_DIM, matVecCpu } from './recommendation-model';

/* Minimal structural types, so the app needs no @webgpu/types dependency. */
type GpuBuffer = {
	destroy(): void;
	mapAsync(mode: number): Promise<void>;
	getMappedRange(): ArrayBuffer;
	unmap(): void;
};
type GpuDevice = {
	createBuffer(d: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBuffer;
	createShaderModule(d: { code: string }): unknown;
	createComputePipeline(d: unknown): { getBindGroupLayout(i: number): unknown };
	createBindGroup(d: unknown): unknown;
	createCommandEncoder(): {
		beginComputePass(): {
			setPipeline(p: unknown): void;
			setBindGroup(i: number, g: unknown): void;
			dispatchWorkgroups(x: number): void;
			end(): void;
		};
		copyBufferToBuffer(a: GpuBuffer, ao: number, b: GpuBuffer, bo: number, size: number): void;
		finish(): unknown;
	};
	queue: {
		writeBuffer(b: GpuBuffer, o: number, data: ArrayBufferView): void;
		submit(c: unknown[]): void;
	};
	lost: Promise<unknown>;
};

/* GPUBufferUsage / GPUMapMode values from the WebGPU spec. */
const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const MODE_READ = 0x0001;

/** Below this many games the CPU loop is faster than a GPU round trip. */
export const GPU_MIN_ROWS = 4096;

const SHADER = /* wgsl */ `
struct Params { n: u32, d: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read> W: array<f32>;
@group(0) @binding(2) var<storage, read_write> Out: array<f32>;
@group(0) @binding(3) var<uniform> P: Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let o = i * P.d;
  var s = 0.0;
  for (var k = 0u; k < P.d; k = k + 1u) { s = s + X[o + k] * W[k]; }
  Out[i] = s;
}`;

type Uploaded = {
	n: number;
	x: GpuBuffer;
	w: GpuBuffer;
	out: GpuBuffer;
	read: GpuBuffer;
	params: GpuBuffer;
	bindGroup: unknown;
};

let devicePromise: Promise<{
	device: GpuDevice;
	pipeline: ReturnType<GpuDevice['createComputePipeline']>;
} | null> | null = null;
let gpuBroken = false;
let lastBackend: 'webgpu' | 'cpu' | null = null;
const uploads = new WeakMap<Float32Array, Uploaded>();
/* One dispatch at a time: rankings share the read-back buffer. */
let gpuQueue: Promise<unknown> = Promise.resolve();

/** Which backend ranked last ('webgpu' or 'cpu'), for the analytics screen. */
export function rankingBackend(): 'webgpu' | 'cpu' | null {
	return lastBackend;
}

export function webGpuAvailable(): boolean {
	return typeof navigator !== 'undefined' && 'gpu' in navigator && !gpuBroken;
}

async function getDevice() {
	if (!webGpuAvailable()) return null;
	devicePromise ??= (async () => {
		try {
			const gpu = (
				navigator as unknown as {
					gpu: { requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null> };
				}
			).gpu;
			const adapter = await gpu.requestAdapter();
			if (!adapter) return null;
			const device = await adapter.requestDevice();
			void device.lost.then(() => {
				devicePromise = null;
			});
			const module = device.createShaderModule({ code: SHADER });
			const pipeline = device.createComputePipeline({
				layout: 'auto',
				compute: { module, entryPoint: 'main' }
			});
			return { device, pipeline };
		} catch {
			gpuBroken = true;
			return null;
		}
	})();
	return devicePromise;
}

function upload(
	device: GpuDevice,
	pipeline: ReturnType<GpuDevice['createComputePipeline']>,
	data: Float32Array,
	n: number
): Uploaded {
	const cached = uploads.get(data);
	if (cached && cached.n === n) return cached;
	const x = device.createBuffer({ size: data.byteLength, usage: STORAGE | COPY_DST });
	device.queue.writeBuffer(x, 0, data);
	const w = device.createBuffer({ size: FEATURE_DIM * 4, usage: STORAGE | COPY_DST });
	const out = device.createBuffer({ size: n * 4, usage: STORAGE | COPY_SRC });
	const read = device.createBuffer({ size: n * 4, usage: MAP_READ | COPY_DST });
	const params = device.createBuffer({ size: 16, usage: UNIFORM | COPY_DST });
	device.queue.writeBuffer(params, 0, new Uint32Array([n, FEATURE_DIM, 0, 0]));
	const bindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: x } },
			{ binding: 1, resource: { buffer: w } },
			{ binding: 2, resource: { buffer: out } },
			{ binding: 3, resource: { buffer: params } }
		]
	});
	const entry = { n, x, w, out, read, params, bindGroup };
	uploads.set(data, entry);
	return entry;
}

/** scores[i] = data[i,:]·w, on WebGPU when worth it, else on the CPU. Never throws. */
export function scoreCatalog(
	data: Float32Array,
	w: Float32Array,
	n: number
): Promise<Float32Array> {
	const run = gpuQueue.then(() => scoreOnce(data, w, n));
	gpuQueue = run.catch(() => undefined);
	return run;
}

async function scoreOnce(data: Float32Array, w: Float32Array, n: number): Promise<Float32Array> {
	if (n >= GPU_MIN_ROWS) {
		try {
			const gpu = await getDevice();
			if (gpu) {
				const { device, pipeline } = gpu;
				const buf = upload(device, pipeline, data, n);
				device.queue.writeBuffer(buf.w, 0, w);
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginComputePass();
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, buf.bindGroup);
				pass.dispatchWorkgroups(Math.ceil(n / 64));
				pass.end();
				encoder.copyBufferToBuffer(buf.out, 0, buf.read, 0, n * 4);
				device.queue.submit([encoder.finish()]);
				await buf.read.mapAsync(MODE_READ);
				const scores = new Float32Array(buf.read.getMappedRange().slice(0));
				buf.read.unmap();
				lastBackend = 'webgpu';
				return scores;
			}
		} catch {
			gpuBroken = true;
		}
	}
	lastBackend = 'cpu';
	return matVecCpu(data, w, n);
}
