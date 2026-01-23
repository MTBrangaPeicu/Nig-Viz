<script lang="ts">
  import '../app.css';
  import '@marcellejs/core/dist/marcelle.css';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const children_render = $derived(children);
</script>

{@render children_render?.()}
