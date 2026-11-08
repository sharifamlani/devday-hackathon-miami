/**
 * The public preview (service/public_mode.py) refuses every write with
 * 403 {"detail": "not available in the public preview"}. The web turns that
 * into one plain sentence instead of showing the raw response.
 */
export const PUBLIC_PREVIEW_MESSAGE =
  "This is a read-only preview, so changes can't be saved here.";

export const isPublicPreviewRefusal = (status: number, body: unknown) =>
  status === 403 &&
  (body as { detail?: unknown } | null)?.detail ===
    "not available in the public preview";
