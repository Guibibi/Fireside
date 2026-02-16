export interface CueAudioCache {
  url: string;
  audio: HTMLAudioElement;
}

export interface CueConfig {
  url: string;
  volume: number;
  fallbackFrequencyHz: number;
  fallbackDurationSec: number;
  fallbackWaveform?: OscillatorType;
}

let sharedAudioContext: AudioContext | null = null;

export function getOrCreateCueAudioContext(): AudioContext | null {
  try {
    sharedAudioContext = sharedAudioContext ?? new AudioContext();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export function getOrCreateCueAudio(
  cache: CueAudioCache | null,
  url: string,
): CueAudioCache {
  if (cache && cache.url === url) {
    return cache;
  }

  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  return { url, audio };
}

export function playFallbackTone(
  frequencyHz: number,
  durationSec: number,
  waveform: OscillatorType = "sine",
): void {
  const audioContext = getOrCreateCueAudioContext();
  if (!audioContext) {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequencyHz, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec - 0.02);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + durationSec);
}

export function playCachedCue(
  cache: CueAudioCache | null,
  config: CueConfig,
): CueAudioCache {
  const next = getOrCreateCueAudio(cache, config.url);
  next.audio.currentTime = 0;
  next.audio.volume = config.volume;
  void next.audio.play().catch(() => {
    playFallbackTone(config.fallbackFrequencyHz, config.fallbackDurationSec, config.fallbackWaveform);
  });
  return next;
}

export function installAudioUnlockHandlers(
  getAudio: () => HTMLAudioElement | null,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let installed = false;

  const unlock = () => {
    const context = getOrCreateCueAudioContext();
    if (context && context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const audio = getAudio();
    if (audio) {
      const previousMuted = audio.muted;
      const previousVolume = audio.volume;
      audio.muted = true;
      audio.volume = 0;
      void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = previousMuted;
        audio.volume = previousVolume;
      }).catch(() => {
        audio.muted = previousMuted;
        audio.volume = previousVolume;
      });
    }

    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };

  if (!installed) {
    installed = true;
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
  }

  return () => {
    if (installed) {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
      installed = false;
    }
  };
}
