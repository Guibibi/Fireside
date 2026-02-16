import { errorMessage } from "../utils/error";

export interface UploadMediaResponse {
  id: string;
  status: "processing" | "ready" | "failed";
}

export function toAbsoluteMediaUrl(apiBaseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  const normalizedServerBaseUrl = normalizedApiBaseUrl.replace(/\/api$/i, "");

  if (/^\/api(\/|$)/i.test(path)) {
    return `${normalizedServerBaseUrl}${path}`;
  }

  if (path.startsWith("/")) {
    return `${normalizedApiBaseUrl}${path}`;
  }

  if (/^api(\/|$)/i.test(path)) {
    return `${normalizedServerBaseUrl}/${path}`;
  }

  return `${normalizedApiBaseUrl}/${path}`;
}

export async function waitForMediaDerivative(
  apiBaseUrl: string,
  authToken: string,
  mediaId: string,
): Promise<void> {
  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const probeUrl = `${toAbsoluteMediaUrl(apiBaseUrl, `/media/${mediaId}/thumbnail`)}?v=${Date.now()}-${attempt}`;
      const response = await fetch(probeUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // keep retrying for transient failures
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw new Error("Timed out preparing image preview");
}

export function validateImageAttachment(file: File): string | null {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  const hasAllowedMimeType = ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/gif"].includes(mimeType);
  const hasAllowedExtension = [".jpg", ".jpeg", ".png", ".webp", ".gif"].some((extension) => name.endsWith(extension));

  if (!hasAllowedMimeType && !hasAllowedExtension) {
    return "Only JPEG, PNG, WEBP, and GIF files are supported";
  }

  if (file.size > 10 * 1024 * 1024) {
    return "Image upload must be 10 MB or smaller";
  }

  return null;
}

export async function uploadMediaFile(
  apiBaseUrl: string,
  authToken: string,
  file: File,
): Promise<UploadMediaResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${apiBaseUrl}/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }

  return response.json() as Promise<UploadMediaResponse>;
}

export function uploadError(error: unknown): string {
  return errorMessage(error, "Failed to upload image");
}
