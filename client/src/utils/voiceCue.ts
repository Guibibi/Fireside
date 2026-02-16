import {
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
} from "../stores/settings";
import {
  getOrCreateCueAudio,
  playCachedCue,
  type CueAudioCache,
} from "./audioCue";

const JOIN_CUE_URL = "/sounds/voice-join.mp3";
const LEAVE_CUE_URL = "/sounds/voice-leave.mp3";

let joinCueAudio: CueAudioCache | null = null;
let leaveCueAudio: CueAudioCache | null = null;

const JOIN_CONFIG = {
  url: JOIN_CUE_URL,
  volume: 0.22,
  fallbackFrequencyHz: 740,
  fallbackDurationSec: 0.16,
  fallbackWaveform: "sine" as OscillatorType,
};

const LEAVE_CONFIG = {
  url: LEAVE_CUE_URL,
  volume: 0.22,
  fallbackFrequencyHz: 520,
  fallbackDurationSec: 0.16,
  fallbackWaveform: "sine" as OscillatorType,
};

function warmCueCache() {
  joinCueAudio = getOrCreateCueAudio(joinCueAudio, JOIN_CUE_URL);
  leaveCueAudio = getOrCreateCueAudio(leaveCueAudio, LEAVE_CUE_URL);
}

export function preloadVoiceCues() {
  warmCueCache();
}

export function playVoiceJoinCue() {
  if (!voiceJoinSoundEnabled()) {
    return;
  }

  joinCueAudio = playCachedCue(joinCueAudio, JOIN_CONFIG);
}

export function playVoiceLeaveCue() {
  if (!voiceLeaveSoundEnabled()) {
    return;
  }

  leaveCueAudio = playCachedCue(leaveCueAudio, LEAVE_CONFIG);
}

warmCueCache();
