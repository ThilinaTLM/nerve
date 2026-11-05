<script lang="ts">
import { buildQrMatrix, QR_QUIET_ZONE } from "../state/qr-matrix";

let { value, label }: { value: string; label: string } = $props();

const matrix = $derived(buildQrMatrix(value));
const extent = $derived(matrix.size + QR_QUIET_ZONE * 2);
</script>

<!-- A QR code has to be dark modules on a light field in every theme or many
     scanners reject it, so these two colours are fixed presentation attributes
     rather than theme tokens. -->
<svg
  viewBox="0 0 {extent} {extent}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
  class="size-48 rounded-md"
>
  <rect width={extent} height={extent} fill="white" />
  <path
    d={matrix.path}
    transform="translate({QR_QUIET_ZONE} {QR_QUIET_ZONE})"
    fill="black"
  />
</svg>
