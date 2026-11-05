import qrcode from "qrcode-generator";

export interface QrMatrix {
  size: number;
  /** SVG path data drawing every dark module as a 1x1 square. */
  path: string;
}

/** Quiet zone required around a QR code, in modules. */
export const QR_QUIET_ZONE = 4;

/** Encodes `text` (error correction M) into square-module path data. */
export function buildQrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!qr.isDark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && qr.isDark(row, col)) col += 1;
      path += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return { size, path };
}
