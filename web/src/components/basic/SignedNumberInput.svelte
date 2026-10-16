<script lang="ts">
  // Number input with a +/- button, for phones whose number keypad has no minus key.
  // Renders two siblings (button + input), so use it directly inside a Bootstrap `.input-group`.
  interface Props {
    value: number;
    onchange?: () => void;
  }

  let { value = $bindable(0), onchange }: Props = $props();

  const negate = () => {
    const n = Number(value) || 0;
    value = n === 0 ? 0 : -n;
    onchange?.();
  };
</script>

<button
  type="button"
  class="btn btn-outline-secondary px-2"
  title="Change sign (+ / -)"
  aria-label="Change sign"
  onclick={negate}>
  ±
</button>
<input class="form-control" type="number" bind:value onchange={() => onchange?.()} />
