<script lang="ts">
type Props = {
  label: string;
  value: string;
};

let { label, value }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-2 px-2.5 py-1.5">
  <span class="text-xs text-muted-foreground">{label}</span>
  <span class="text-xs font-medium text-foreground">{value}</span>
</div>
