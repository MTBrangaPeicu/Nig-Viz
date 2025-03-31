<svelte:options />

<script>
	import { onDestroy } from 'svelte';

	let options = {};
	let unsubscribe;

	// Subscribe to the reactive options store
	export let options$;
	if (options$) {
		unsubscribe = options$.subscribe((value) => {
			options = value;
		});
	}

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});
</script>

<div>
	<h3 class="my-color">Layer: {options.layer || "None selected"}</h3>
	<p><strong>Values:</strong> {JSON.stringify(options.values || "No values available")}</p>
	<p><strong>Error:</strong> {JSON.stringify(options.error || "No error available")}</p>
</div>

<style>
	.my-color {
		color: seagreen;
	}
</style>
