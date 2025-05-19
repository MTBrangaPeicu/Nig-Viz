<script>
	"use strict";
	import { onDestroy } from 'svelte';

	export let options$;
	let options = {};
	let unsubscribe;

	// Subscribe to the reactive options store
	if (options$) {
		unsubscribe = options$.subscribe((value) => {
			options = value;
		});
	}

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});

	$: progress = options.progress || 0; // Reactive assignment for progress
</script>

<div class="progress-container">
	<div class="progress-bar" style="width: {progress}%;"></div>
	{#if progress < 100}
		<span class="progress-percentage">{progress}%</span>
	{/if}
</div>

<style>
	.progress-container {
		width: 100%;
		background-color: #f3f3f3;
		border: 1px solid #ccc;
		border-radius: 5px;
		overflow: hidden;
		height: 20px;
		margin-top: 10px;
		display: flex;
		align-items: center;
		position: relative;
	}

	.progress-bar {
		height: 100%;
		background-color: seagreen;
		transition: width 0.2s ease;
	}

	.progress-percentage {
		position: absolute;
		right: 10px;
		color: #000;
		font-weight: bold;
		font-size: 14px;
	}
</style>
