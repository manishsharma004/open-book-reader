<script lang="ts">
	import { page } from '$app/state';
</script>

<main class="mx-auto flex max-w-lg flex-col gap-3 p-6">
	<p class="text-sm font-medium">{page.status}</p>
	<p class="text-sm">{page.error?.message ?? 'Something went wrong.'}</p>
	<a class="text-sm underline" href="/">Back to the library</a>
</main>
