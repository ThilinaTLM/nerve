<script lang="ts">
  type Props = {
    status?: string;
    text: string;
  };

  let { status = "idle", text }: Props = $props();
</script>

<div class="settings-save-state" data-status={status}>
  <span></span>
  <p>{text}</p>
</div>
