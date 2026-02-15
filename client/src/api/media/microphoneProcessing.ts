interface MicrophoneProcessingSession {
  context: AudioContext;
  gainNode: GainNode;
  sourceTrack: MediaStreamTrack;
  track: MediaStreamTrack;
}

let activeSession: MicrophoneProcessingSession | null = null;

function clampVoiceVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(200, Math.round(volume)));
}

export function disposeMicrophoneProcessing() {
  if (!activeSession) {
    return;
  }

  activeSession.sourceTrack.stop();
  activeSession.track.stop();
  if (activeSession.context.state !== "closed") {
    void activeSession.context.close().catch(() => undefined);
  }

  activeSession = null;
}

export function createProcessedMicrophoneTrack(stream: MediaStream, volume: number, muted: boolean): MicrophoneProcessingSession {
  const [sourceTrack] = stream.getAudioTracks();
  if (!sourceTrack) {
    throw new Error("Microphone track was not available");
  }

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  const destinationNode = audioContext.createMediaStreamDestination();

  gainNode.gain.value = clampVoiceVolume(volume) / 100;
  sourceNode.connect(gainNode);
  gainNode.connect(destinationNode);

  const [processedTrack] = destinationNode.stream.getAudioTracks();
  if (!processedTrack) {
    sourceTrack.stop();
    void audioContext.close().catch(() => undefined);
    throw new Error("Processed microphone track was not available");
  }

  sourceTrack.enabled = !muted;
  processedTrack.enabled = !muted;
  void audioContext.resume().catch(() => undefined);

  return {
    context: audioContext,
    gainNode,
    sourceTrack,
    track: processedTrack,
  };
}

export function activateMicrophoneProcessing(session: MicrophoneProcessingSession) {
  disposeMicrophoneProcessing();
  activeSession = session;
}

export function disposePendingMicrophoneProcessing(session: MicrophoneProcessingSession) {
  session.sourceTrack.stop();
  session.track.stop();
  if (session.context.state !== "closed") {
    void session.context.close().catch(() => undefined);
  }
}

export function disposeMicrophoneProcessingForTrack(track: MediaStreamTrack): boolean {
  if (!activeSession || activeSession.track !== track) {
    return false;
  }

  disposeMicrophoneProcessing();
  return true;
}

export function updateOutgoingMicrophoneGain(volume: number) {
  if (!activeSession) {
    return;
  }

  activeSession.gainNode.gain.value = clampVoiceVolume(volume) / 100;
}

export function updateOutgoingMicrophoneMuted(muted: boolean) {
  if (!activeSession) {
    return;
  }

  activeSession.sourceTrack.enabled = !muted;
  activeSession.track.enabled = !muted;
}
