import {
  voiceJoinSoundEnabled,
  voiceJoinSoundUrl,
  voiceLeaveSoundEnabled,
  voiceLeaveSoundUrl,
} from "../stores/settings";

let cueAudioContext: AudioContext | null = null;

function getOrCreateCueAudioContext(): AudioContext | null {
  try {
    cueAudioContext = cueAudioContext ?? new AudioContext();
    return cueAudioContext;
  } catch {
    return null;
  }
}

function playFallbackTone(frequencyHz: number) {
  const audioContext = getOrCreateCueAudioContext();
  if (!audioContext) {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequencyHz, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.16);
}

function playCue(url: string, fallbackFrequencyHz: number) {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = 0.22;

  void audio.play().catch(() => {
    playFallbackTone(fallbackFrequencyHz);
  });
}

export function playVoiceJoinCue() {
  if (!voiceJoinSoundEnabled()) {
    return;
  }

  playCue(voiceJoinSoundUrl(), 740);
}

export function playVoiceLeaveCue() {
  if (!voiceLeaveSoundEnabled()) {
    return;
  }

  playCue(voiceLeaveSoundUrl(), 520);
}
