<script lang="ts">
  import '../app.css';
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  const children_render = $derived(children);
</script>

{@render children_render?.()}
