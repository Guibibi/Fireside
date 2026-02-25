import { createRnnoiseNode, destroyRnnoiseNode, RnnoiseWorkletNode } from "./rnnoise";

export interface MicrophoneProcessingSession {
  context: AudioContext;
  sourceNode: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  destinationNode: MediaStreamAudioDestinationNode;
  rnnoiseNode: RnnoiseWorkletNode | null;
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

  if (activeSession.rnnoiseNode) {
    destroyRnnoiseNode(activeSession.rnnoiseNode);
    activeSession.rnnoiseNode = null;
  }

  activeSession.sourceTrack.stop();
  activeSession.track.stop();
  if (activeSession.context.state !== "closed") {
    void activeSession.context.close().catch(() => undefined);
  }

  activeSession = null;
}

export async function createProcessedMicrophoneTrack(
  stream: MediaStream,
  volume: number,
  muted: boolean,
  noiseSuppression: boolean,
): Promise<MicrophoneProcessingSession> {
  const [sourceTrack] = stream.getAudioTracks();
  if (!sourceTrack) {
    throw new Error("Microphone track was not available");
  }

  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  const destinationNode = audioContext.createMediaStreamDestination();

  gainNode.gain.value = clampVoiceVolume(volume) / 100;

  let rnnoiseNode: RnnoiseWorkletNode | null = null;
  if (noiseSuppression) {
    rnnoiseNode = await createRnnoiseNode(audioContext);
  }

  if (rnnoiseNode) {
    sourceNode.connect(rnnoiseNode);
    rnnoiseNode.connect(gainNode);
  } else {
    sourceNode.connect(gainNode);
  }
  gainNode.connect(destinationNode);

  const [processedTrack] = destinationNode.stream.getAudioTracks();
  if (!processedTrack) {
    if (rnnoiseNode) {
      destroyRnnoiseNode(rnnoiseNode);
    }
    sourceTrack.stop();
    void audioContext.close().catch(() => undefined);
    throw new Error("Processed microphone track was not available");
  }

  sourceTrack.enabled = !muted;
  processedTrack.enabled = !muted;
  void audioContext.resume().catch(() => undefined);

  return {
    context: audioContext,
    sourceNode,
    gainNode,
    destinationNode,
    rnnoiseNode,
    sourceTrack,
    track: processedTrack,
  };
}

export function activateMicrophoneProcessing(session: MicrophoneProcessingSession) {
  disposeMicrophoneProcessing();
  activeSession = session;
}

export function disposePendingMicrophoneProcessing(session: MicrophoneProcessingSession) {
  if (session.rnnoiseNode) {
    destroyRnnoiseNode(session.rnnoiseNode);
    session.rnnoiseNode = null;
  }

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

export async function updateRnnoiseEnabled(enabled: boolean): Promise<void> {
  if (!activeSession) {
    return;
  }

  if (enabled && !activeSession.rnnoiseNode) {
    const { context, sourceNode, gainNode } = activeSession;

    try {
      sourceNode.disconnect(gainNode);
    } catch {
      // may not be directly connected
    }

    const newNode = await createRnnoiseNode(context);
    if (!activeSession) {
      // session was disposed during async WASM load
      if (newNode) {
        destroyRnnoiseNode(newNode);
      }
      return;
    }

    if (newNode) {
      sourceNode.connect(newNode);
      newNode.connect(gainNode);
      activeSession.rnnoiseNode = newNode;
      console.debug("[rnnoise] Noise suppression enabled dynamically");
    } else {
      sourceNode.connect(gainNode);
    }
  } else if (!enabled && activeSession.rnnoiseNode) {
    const { sourceNode, gainNode, rnnoiseNode } = activeSession;

    try {
      sourceNode.disconnect(rnnoiseNode);
    } catch {
      // best effort
    }
    destroyRnnoiseNode(rnnoiseNode);
    activeSession.rnnoiseNode = null;
    sourceNode.connect(gainNode);
    console.debug("[rnnoise] Noise suppression disabled dynamically");
  }
}
