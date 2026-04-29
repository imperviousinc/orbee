import type { Signer } from "./signer";

const BLOSSOM_SERVER = "https://blossom.primal.net";

// SHA-256 hash a file in the browser
async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Create a Blossom auth event (kind 24242)
async function createAuthEvent(
  signer: Signer,
  hash: string,
  size: number
): Promise<string> {
  const event = await signer.signEvent({
    kind: 24242,
    content: "Upload",
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["size", size.toString()],
      ["expiration", (Math.floor(Date.now() / 1000) + 300).toString()],
    ],
  });
  return btoa(JSON.stringify(event));
}

export interface UploadResult {
  url: string;
  hash: string;
  size: number;
  type: string;
}

export async function uploadToBlossom(
  file: File,
  signer: Signer,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  const hash = await sha256File(file);
  onProgress?.(10);

  const authBase64 = await createAuthEvent(signer, hash, file.size);
  onProgress?.(20);

  const response = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      Authorization: `Nostr ${authBase64}`,
    },
    body: file,
  });

  onProgress?.(90);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  onProgress?.(100);

  return {
    url: result.url || `${BLOSSOM_SERVER}/${hash}.${file.name.split(".").pop()}`,
    hash,
    size: file.size,
    type: file.type,
  };
}

// Get image dimensions from a File
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
