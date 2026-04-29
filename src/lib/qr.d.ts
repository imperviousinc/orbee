// Minimal type shim for qr.js - the hand-written QR encoder. We only use
// the two methods Orbee actually touches: addData + make + moduleCount /
// isDark to walk the matrix ourselves for SVG output.

export interface QRCodeInstance {
  addData(data: string, mode?: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
  createSvgTag(opts?: Record<string, unknown>): string;
  createImgTag(cellSize?: number, margin?: number): string;
  createDataURL(cellSize?: number, margin?: number): string;
}

type QRCodeFactory = (typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H") => QRCodeInstance;

declare const qrcode: QRCodeFactory & {
  stringToBytes(s: string): number[];
  createStringToBytes?: unknown;
};

export default qrcode;
