export function normalizeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError"
      || error.name === "PermissionDeniedError"
      || error.name === "SecurityError"
    ) {
      return "Camera access was denied. Please allow camera permission and try again.";
    }

    if (
      error.name === "NotFoundError"
      || error.name === "DevicesNotFoundError"
      || error.name === "OverconstrainedError"
    ) {
      return "No camera device was found. Connect a camera and try again.";
    }

    if (
      error.name === "NotReadableError"
      || error.name === "TrackStartError"
      || error.name === "AbortError"
    ) {
      return "Camera is unavailable or in use by another app.";
    }
  }

  return error instanceof Error ? error.message : "Failed to start camera";
}

export function isMissingDeviceError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return (
    error.name === "NotFoundError"
    || error.name === "DevicesNotFoundError"
    || error.name === "OverconstrainedError"
  );
}
