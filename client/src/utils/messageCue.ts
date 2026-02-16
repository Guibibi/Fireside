import { messageNotificationSoundEnabled } from "../stores/settings";

const MESSAGE_CUE_URL = "/sounds/message-notification.mp3";

let cueAudioContext: AudioContext | null = null;
let messageCueAudio: { url: string; audio: HTMLAudioElement } | null = null;
let unlockHandlersInstalled = false;

function getOrCreateCueAudioContext(): AudioContext | null {
  try {
    cueAudioContext = cueAudioContext ?? new AudioContext();
    return cueAudioContext;
  } catch {
    return null;
  }
}

function playFallbackTone() {
  const audioContext = getOrCreateCueAudioContext();
  if (!audioContext) {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(680, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.22);
}

function getOrCreateCueAudio(
  cache: { url: string; audio: HTMLAudioElement } | null,
  url: string,
): { url: string; audio: HTMLAudioElement } {
  if (cache && cache.url === url) {
    return cache;
  }

  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  return { url, audio };
}

function installUnlockHandlers() {
  if (unlockHandlersInstalled || typeof window === "undefined") {
    return;
  }

  unlockHandlersInstalled = true;

  const unlock = () => {
    const context = getOrCreateCueAudioContext();
    if (context && context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    if (messageCueAudio) {
      const { audio } = messageCueAudio;
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

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

function warmCueCache() {
  messageCueAudio = getOrCreateCueAudio(messageCueAudio, MESSAGE_CUE_URL);
  installUnlockHandlers();
}

export function preloadMessageNotificationCue() {
  warmCueCache();
}

export function playMessageNotificationCue() {
  if (!messageNotificationSoundEnabled()) {
    return;
  }

  const next = getOrCreateCueAudio(messageCueAudio, MESSAGE_CUE_URL);
  messageCueAudio = next;
  next.audio.currentTime = 0;
  next.audio.muted = false;
  next.audio.volume = 0.38;
  void next.audio.play().catch(() => {
    const context = getOrCreateCueAudioContext();
    if (context && context.state === "suspended") {
      void context.resume().finally(() => {
        playFallbackTone();
      });
      return;
    }

    playFallbackTone();
  });
}

warmCueCache();
