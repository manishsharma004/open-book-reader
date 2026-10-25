export function handleError({ error, message }: { error: unknown; message: string }) {
	const text = error instanceof Error && error.message ? error.message : message;
	return { message: text };
}
