export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith('#lib/')) {
		const name = specifier.slice('#lib/'.length).replace(/\.js$/, '.ts');
		return {
			url: new URL(`../src/lib/${name}`, import.meta.url).href,
			shortCircuit: true
		};
	}
	return nextResolve(specifier, context);
}
