import { messageNotificationSoundEnabled } from "../stores/settings";
import {
  getOrCreateCueAudioContext,
  getOrCreateCueAudio,
  playFallbackTone,
  installAudioUnlockHandlers,
  type CueAudioCache,
} from "./audioCue";

const MESSAGE_CUE_URL = "/sounds/message-notification.mp3";

let messageCueAudio: CueAudioCache | null = null;
let unlockHandlersInstalled = false;

function installUnlockHandlers() {
  if (unlockHandlersInstalled || typeof window === "undefined") {
    return;
  }

  unlockHandlersInstalled = true;
  installAudioUnlockHandlers(() => messageCueAudio?.audio ?? null);
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

  messageCueAudio = getOrCreateCueAudio(messageCueAudio, MESSAGE_CUE_URL);
  const { audio } = messageCueAudio;
  audio.currentTime = 0;
  audio.muted = false;
  audio.volume = 0.38;
  void audio.play().catch(() => {
    const context = getOrCreateCueAudioContext();
    if (context && context.state === "suspended") {
      void context.resume().finally(() => {
        playFallbackTone(680, 0.22, "triangle");
      });
      return;
    }

    playFallbackTone(680, 0.22, "triangle");
  });
}

warmCueCache();
