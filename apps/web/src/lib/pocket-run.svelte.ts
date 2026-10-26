/** Device label reported by the on-device Pocket session, such as `webnn-npu` or `wasm`. */
export const pocketRun = $state({ device: '' });

export function setPocketRunDevice(device: string) {
	if (device) pocketRun.device = device;
}
