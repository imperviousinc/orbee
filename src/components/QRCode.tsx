import { createMemo } from "solid-js";
import qrcode from "../lib/qr.js";

/**
 * Renders a QR code as inline SVG. Uses Kazuhiko Arase's qrcode-generator
 * (src/lib/qr.js) - we walk the module matrix ourselves and emit a single
 * <path> of black cells so the DOM stays tiny.
 *
 * typeNumber=0 lets the library auto-pick the smallest version that fits
 * the payload. errorCorrection=M is a reasonable middle ground for
 * scanner robustness without inflating density.
 */
export default function QRCode(props: {
  data: string;
  size?: number;
  background?: string;
  foreground?: string;
}) {
  const svg = createMemo(() => {
    if (!props.data) return "";
    try {
      const qr = qrcode(0, "M");
      qr.addData(props.data);
      qr.make();
      const n = qr.getModuleCount();
      const s = props.size ?? 240;
      const cell = s / n;
      // Build one <path d="M..."> command per dark cell. Rendering a
      // single path is faster than N² <rect>s and produces a smaller DOM.
      let d = "";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) {
            const x = (c * cell).toFixed(2);
            const y = (r * cell).toFixed(2);
            const cs = cell.toFixed(2);
            d += `M${x} ${y}h${cs}v${cs}h-${cs}z`;
          }
        }
      }
      const bg = props.background ?? "#ffffff";
      const fg = props.foreground ?? "#000000";
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">` +
        `<rect width="${s}" height="${s}" fill="${bg}"/>` +
        `<path d="${d}" fill="${fg}"/>` +
        `</svg>`
      );
    } catch {
      return "";
    }
  });

  return (
    <div class="qr-code" innerHTML={svg()} />
  );
}
