import { createSignal } from "solid-js";

const STORAGE_KEY = "yankcord_user_volumes";

export function clampUserVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(100, Math.round(volume)));
}

function loadVolumes(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries: [string, number][] = JSON.parse(raw);
      let changed = false;
      const normalizedEntries = entries.map(([username, value]) => {
        const normalized = clampUserVolume(value);
        if (normalized !== value) {
          changed = true;
        }
        return [username, normalized] as [string, number];
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedEntries));
      }

      return new Map(normalizedEntries);
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
