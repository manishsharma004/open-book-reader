/** WebNN NPU first, then the GPU, then WASM. A phone NPU is offered only when the page can see WebNN. */
export function pocketDeviceProviders(webnn) {
	const providers = [];
	if (webnn) {
		providers.push({ name: 'webnn', deviceType: 'npu', powerPreference: 'default' });
		providers.push({ name: 'webnn', deviceType: 'gpu', powerPreference: 'default' });
	}
	providers.push('wasm');
	return providers;
}

export function pocketDeviceLabel(provider) {
	if (typeof provider === 'string') return provider;
	return `${provider.name}-${provider.deviceType}`;
}
