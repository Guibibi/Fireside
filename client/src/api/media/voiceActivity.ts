import {
  initializedForChannelId,
  micLevelAnalyserNode,
  micLevelAudioContext,
  micLevelData,
  micLevelMonitorFrame,
  micLevelSourceNode,
  microphoneMuted,
  micSpeakingHoldUntil,
  micSpeakingLastSent,
  setMicLevelAnalyserNode,
  setMicLevelAudioContext,
  setMicLevelData,
  setMicLevelMonitorFrame,
  setMicLevelSourceNode,
  setMicSpeakingHoldUntil,
  setMicSpeakingLastSent,
} from "./state";
import { reportVoiceActivity } from "./signaling";

function internalReportVoiceActivity(channelId: string, speaking: boolean) {
  if (micSpeakingLastSent === speaking) {
    return;
  }

  setMicSpeakingLastSent(speaking);
  reportVoiceActivity(channelId, speaking);
}

export function stopMicLevelMonitoring(channelId: string | null) {
  if (micLevelMonitorFrame !== null) {
    cancelAnimationFrame(micLevelMonitorFrame);
    setMicLevelMonitorFrame(null);
  }

  setMicSpeakingHoldUntil(0);

  if (channelId && micSpeakingLastSent) {
    internalReportVoiceActivity(channelId, false);
  }

  micLevelSourceNode?.disconnect();
  setMicLevelSourceNode(null);
  micLevelAnalyserNode?.disconnect();
  setMicLevelAnalyserNode(null);
  setMicLevelData(null);

  if (micLevelAudioContext) {
    void micLevelAudioContext.close().catch(() => undefined);
    setMicLevelAudioContext(null);
  }

  setMicSpeakingLastSent(false);
}

export function startMicLevelMonitoring(channelId: string, stream: MediaStream) {
  stopMicLevelMonitoring(initializedForChannelId ?? channelId);

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();

  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.85;
  sourceNode.connect(analyserNode);

  const data = new Uint8Array(analyserNode.frequencyBinCount);

  setMicLevelAudioContext(audioContext);
  setMicLevelSourceNode(sourceNode);
  setMicLevelAnalyserNode(analyserNode);
  setMicLevelData(data);
  setMicSpeakingHoldUntil(0);
  setMicSpeakingLastSent(false);

  const levelThreshold = 0.04;
  const speakingHoldMs = 220;

  const monitor = () => {
    const currentAnalyser = micLevelAnalyserNode;
    const currentData = micLevelData;

    if (!currentAnalyser || !currentData || initializedForChannelId !== channelId) {
      return;
    }

    currentAnalyser.getByteTimeDomainData(currentData);

    let sum = 0;
    for (let i = 0; i < currentData.length; i += 1) {
      const normalized = (currentData[i] - 128) / 128;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / currentData.length);
    const now = performance.now();

    if (rms >= levelThreshold && !microphoneMuted) {
      setMicSpeakingHoldUntil(now + speakingHoldMs);
    }

    const speaking = !microphoneMuted && now <= micSpeakingHoldUntil;
    internalReportVoiceActivity(channelId, speaking);

    setMicLevelMonitorFrame(requestAnimationFrame(monitor));
  };

  setMicLevelMonitorFrame(requestAnimationFrame(monitor));
}
