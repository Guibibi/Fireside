import { createSignal } from "solid-js";

const STORAGE_KEY = "yankcord_user_volumes";

export function clampUserVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(200, Math.round(volume)));
}

function loadVolumes(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries: [string, number][] = JSON.parse(raw);
      return new Map(entries);
    }
  } catch {
    // ignore corrupt data
  }
  return new Map();
}

function persistVolumes(volumes: Map<string, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(volumes.entries())));
}

const [volumeMap, setVolumeMap] = createSignal<Map<string, number>>(loadVolumes());

export function getUserVolume(username: string): number {
  return volumeMap().get(username) ?? 100;
}

export function setUserVolume(username: string, volume: number) {
  const clamped = clampUserVolume(volume);
  setVolumeMap((prev) => {
    const next = new Map(prev);
    if (clamped === 100) {
      next.delete(username);
    } else {
      next.set(username, clamped);
    }
    persistVolumes(next);
    return next;
  });
}

export { volumeMap };
