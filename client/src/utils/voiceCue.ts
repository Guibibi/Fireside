import {
  voiceJoinSoundEnabled,
  voiceLeaveSoundEnabled,
} from "../stores/settings";

const JOIN_CUE_URL = "/sounds/voice-join.mp3";
const LEAVE_CUE_URL = "/sounds/voice-leave.mp3";

let cueAudioContext: AudioContext | null = null;
let joinCueAudio: { url: string; audio: HTMLAudioElement } | null = null;
let leaveCueAudio: { url: string; audio: HTMLAudioElement } | null = null;

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

function playCachedCue(
  type: "join" | "leave",
  url: string,
  fallbackFrequencyHz: number,
) {
  const cache = type === "join" ? joinCueAudio : leaveCueAudio;
  const next = getOrCreateCueAudio(cache, url);
  if (type === "join") {
    joinCueAudio = next;
  } else {
    leaveCueAudio = next;
  }

  next.audio.currentTime = 0;
  next.audio.volume = 0.22;
  void next.audio.play().catch(() => {
    playFallbackTone(fallbackFrequencyHz);
  });
}

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

  playCachedCue("join", JOIN_CUE_URL, 740);
}

export function playVoiceLeaveCue() {
  if (!voiceLeaveSoundEnabled()) {
    return;
  }

  playCachedCue("leave", LEAVE_CUE_URL, 520);
}

warmCueCache();
