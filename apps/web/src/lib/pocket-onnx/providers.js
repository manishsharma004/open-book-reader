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

/** The device a running session actually used. Empty until a session has started. */
export function pocketDeviceKind(label) {
	const value = String(label || '').toLowerCase();
	if (value.includes('npu')) return 'npu';
	if (value.includes('gpu')) return 'gpu';
	if (value === 'wasm' || value.includes('cpu')) return 'cpu';
	return '';
}

export function pocketDeviceTitle(label) {
	const kind = pocketDeviceKind(label);
	if (kind === 'npu') return 'NPU';
	if (kind === 'gpu') return 'GPU';
	if (kind === 'cpu') return 'CPU';
	return '';
}

export function describePocketRun(label, webnn) {
	const kind = pocketDeviceKind(label);
	if (kind === 'npu') return { kind, text: 'Running on the NPU.' };
	if (kind === 'gpu') return { kind, text: 'Running on the GPU.' };
	if (kind === 'cpu') return { kind, text: 'Running on the CPU.' };
	if (!webnn) return { kind: 'cpu', text: 'CPU. This browser has no WebNN, so the model runs on the CPU.' };
	return { kind: 'pending', text: 'Not loaded yet. The first clip tries the NPU, then the GPU, then the CPU.' };
}
