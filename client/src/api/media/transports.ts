import { Device } from "mediasoup-client";
import type { Transport } from "mediasoup-client/types";
import type { TransportHealthState } from "./types";
import { isObject } from "./codecs";
import { flushQueuedProducerAnnouncements, disposeRemoteConsumer } from "./consumers";
import { registerDeviceChangeListener, unregisterDeviceChangeListener } from "./devices";
import { disarmNativeCapture } from "./native";
import { startLocalAudioProducer } from "./producers";
import {
  reportVoiceActivity,
  reportVoiceMuteState,
  requestMediaSignal,
  toTransportOptions,
} from "./signaling";
import {
  cameraProducer,
  cameraStream,
  cameraTrack,
  device,
  initializedForChannelId,
  initializePromise,
  initializingForChannelId,
  micProducer,
  micStream,
  micTrack,
  microphoneMuted,
  pendingRequests,
  producerRoutingModeById,
  producerSourceById,
  producerUsernameById,
  queuedProducerAnnouncements,
  recvTransport,
  remoteAudioElements,
  remoteConsumers,
  screenProducer,
  screenStream,
  screenTrack,
  sendTransport,
  speakersMuted,
  setCameraEnabled,
  setCameraError,
  setCameraProducer,
  setCameraStream,
  setCameraTrack,
  setDevice,
  setInitializedForChannelId,
  setInitializePromise,
  setInitializingForChannelId,
  setMicProducer,
  setMicStream,
  setMicTrack,
  setRecvTransport,
  setScreenEnabled,
  setScreenError,
  setScreenProducer,
  setScreenRoutingMode,
  setScreenStream,
  setScreenTrack,
  setSendTransport,
  setMicrophoneMutedState,
  setSpeakersMutedState,
  setTransportHealthState,
} from "./state";
import { clearRemoteVideoTiles, notifyCameraStateSubscribers, notifyScreenStateSubscribers, notifyTransportHealthSubscribers } from "./subscriptions";
import { stopMicLevelMonitoring } from "./voiceActivity";
import { disposeMicrophoneProcessing, updateOutgoingMicrophoneMuted } from "./microphoneProcessing";

const transportStateSeverity: Record<string, number> = {
  connected: 0,
  new: 1,
  closed: 2,
  disconnected: 3,
  failed: 4,
};

function worstTransportState(a: string | undefined, b: string | undefined): TransportHealthState {
  const sa = transportStateSeverity[a ?? "new"] ?? 1;
  const sb = transportStateSeverity[b ?? "new"] ?? 1;
  const worst = sa >= sb ? (a ?? "new") : (b ?? "new");
  return worst as TransportHealthState;
}

export function updateTransportHealthFromIce() {
  const state = worstTransportState(
    sendTransport?.connectionState,
    recvTransport?.connectionState,
  );
  setTransportHealthState(state);
  notifyTransportHealthSubscribers();
}

function wireTransportConnect(channelId: string, transport: Transport) {
  transport.on("connect", ({ dtlsParameters }, callback, errback) => {
    requestMediaSignal(channelId, "connect_webrtc_transport", {
      transport_id: transport.id,
      dtls_parameters: dtlsParameters,
    })
      .then(() => callback())
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error("Failed to connect transport");
        errback(normalized);
      });
  });
}

let disconnectRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

function wireTransportConnectionStateMonitor(transport: Transport) {
  transport.on("connectionstatechange", (state: string) => {
    updateTransportHealthFromIce();

    if (state === "failed") {
      if (disconnectRecoveryTimer) {
        clearTimeout(disconnectRecoveryTimer);
        disconnectRecoveryTimer = null;
      }
      console.warn("[media] Transport ICE connection failed, closing transports");
      closeTransports();
      return;
    }

    if (state === "disconnected") {
      if (disconnectRecoveryTimer) {
        clearTimeout(disconnectRecoveryTimer);
      }
      disconnectRecoveryTimer = setTimeout(() => {
        disconnectRecoveryTimer = null;
        console.warn("[media] Transport ICE disconnected for 10s, closing transports");
        closeTransports();
      }, 10_000);
      return;
    }

    if (state === "connected" && disconnectRecoveryTimer) {
      clearTimeout(disconnectRecoveryTimer);
      disconnectRecoveryTimer = null;
    }
  });
}

function wireSendTransportProduce(channelId: string, transport: Transport) {
  transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
    const appDataSource = isObject(appData) && typeof appData.source === "string"
      ? appData.source
      : undefined;
    const appDataRoutingMode = isObject(appData) && typeof appData.routingMode === "string"
      ? appData.routingMode
      : undefined;

    requestMediaSignal(channelId, "media_produce", {
      kind,
      rtp_parameters: rtpParameters,
      source: appDataSource,
      routing_mode: appDataRoutingMode,
    })
      .then((response) => {
        if (response.action !== "media_produced" || !response.producer_id) {
          throw new Error("Unexpected media_produce response from server");
        }

        callback({ id: response.producer_id });
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error("Failed to produce track");
        errback(normalized);
      });
  });
}

export function closeTransports() {
  if (disconnectRecoveryTimer) {
    clearTimeout(disconnectRecoveryTimer);
    disconnectRecoveryTimer = null;
  }
  unregisterDeviceChangeListener();
  stopMicLevelMonitoring(initializedForChannelId);

  micProducer?.close();
  setMicProducer(null);

  if (micTrack) {
    micTrack.stop();
    setMicTrack(null);
  }

  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    setMicStream(null);
  }

  disposeMicrophoneProcessing();

  cameraProducer?.close();
  setCameraProducer(null);

  if (cameraTrack) {
    cameraTrack.stop();
    setCameraTrack(null);
  }

  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    setCameraStream(null);
  }
  setCameraEnabled(false);
  setCameraError(null);
  notifyCameraStateSubscribers();

  screenProducer?.close();
  setScreenProducer(null);

  if (screenTrack) {
    screenTrack.stop();
    setScreenTrack(null);
  }

  if (screenStream) {
    for (const track of screenStream.getTracks()) {
      track.stop();
    }
    setScreenStream(null);
  }
  setScreenEnabled(false);
  setScreenError(null);
  setScreenRoutingMode(null);
  notifyScreenStateSubscribers();
  void disarmNativeCapture();

  for (const consumerId of remoteConsumers.keys()) {
    disposeRemoteConsumer(consumerId);
  }

  sendTransport?.close();
  recvTransport?.close();
  setSendTransport(null);
  setRecvTransport(null);
  setTransportHealthState("closed");
  notifyTransportHealthSubscribers();
  setDevice(null);
  setInitializedForChannelId(null);
  setInitializingForChannelId(null);
  queuedProducerAnnouncements.clear();
  producerUsernameById.clear();
  producerSourceById.clear();
  producerRoutingModeById.clear();
  clearRemoteVideoTiles();
}

export async function initializeMediaTransports(channelId: string) {
  if (
    initializedForChannelId === channelId
    && device
    && sendTransport
    && recvTransport
  ) {
    return;
  }

  if (initializePromise) {
    if (initializingForChannelId === channelId) {
      return initializePromise;
    }

    try {
      await initializePromise;
    } catch {}

    if (
      initializedForChannelId === channelId
      && device
      && sendTransport
      && recvTransport
    ) {
      return;
    }
  }

  const INIT_OVERALL_TIMEOUT_MS = 15_000;

  const promise = (async () => {
    setInitializingForChannelId(channelId);
    closeTransports();

    const initWork = (async () => {
      const capabilitiesResponse = await requestMediaSignal(channelId, "get_router_rtp_capabilities");
      if (capabilitiesResponse.action !== "router_rtp_capabilities") {
        throw new Error("Unexpected capabilities response from media signaling");
      }

      const routerRtpCapabilities = capabilitiesResponse.rtp_capabilities;
      if (!routerRtpCapabilities) {
        throw new Error("Router RTP capabilities were not provided by server");
      }

      const nextDevice = new Device();
      await nextDevice.load({
        routerRtpCapabilities: routerRtpCapabilities as Parameters<Device["load"]>[0]["routerRtpCapabilities"],
      });

      const sendTransportResponse = await requestMediaSignal(channelId, "create_webrtc_transport", {
        direction: "send",
      });
      const recvTransportResponse = await requestMediaSignal(channelId, "create_webrtc_transport", {
        direction: "recv",
      });

      if (sendTransportResponse.action !== "webrtc_transport_created") {
        throw new Error("Unexpected send transport response from media signaling");
      }

      if (recvTransportResponse.action !== "webrtc_transport_created") {
        throw new Error("Unexpected recv transport response from media signaling");
      }

      const nextSendTransport = nextDevice.createSendTransport(toTransportOptions(sendTransportResponse));
      const nextRecvTransport = nextDevice.createRecvTransport(toTransportOptions(recvTransportResponse));

      wireTransportConnect(channelId, nextSendTransport);
      wireTransportConnect(channelId, nextRecvTransport);
      wireSendTransportProduce(channelId, nextSendTransport);
      wireTransportConnectionStateMonitor(nextSendTransport);
      wireTransportConnectionStateMonitor(nextRecvTransport);

      setDevice(nextDevice);
      setSendTransport(nextSendTransport);
      setRecvTransport(nextRecvTransport);
      setTransportHealthState("new");
      notifyTransportHealthSubscribers();
      setInitializedForChannelId(channelId);
      setInitializingForChannelId(null);

      await startLocalAudioProducer(channelId);
      registerDeviceChangeListener();
      flushQueuedProducerAnnouncements(channelId);
    })();

    const overallTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Media transport initialization timed out")), INIT_OVERALL_TIMEOUT_MS);
    });

    try {
      await Promise.race([initWork, overallTimeout]);
    } catch (error) {
      cleanupMediaTransports();
      throw error;
    }
  })();

  setInitializePromise(promise);

  try {
    await promise;
  } finally {
    if (initializedForChannelId !== channelId) {
      setInitializingForChannelId(null);
    }
    setInitializePromise(null);
  }
}

export function setMicrophoneMuted(muted: boolean) {
  setMicrophoneMutedState(muted);
  updateOutgoingMicrophoneMuted(muted);
  if (micTrack) {
    micTrack.enabled = !muted;
  }

  const currentChannelId = initializedForChannelId;
  if (!currentChannelId) {
    return;
  }

  if (muted) {
    reportVoiceActivity(currentChannelId, false);
  }

  reportVoiceMuteState(currentChannelId, microphoneMuted, speakersMuted);
}

export function setSpeakersMuted(muted: boolean) {
  setSpeakersMutedState(muted);
  for (const audio of remoteAudioElements.values()) {
    audio.muted = muted;
  }

  const currentChannelId = initializedForChannelId;
  if (!currentChannelId) {
    return;
  }

  reportVoiceMuteState(currentChannelId, microphoneMuted, speakersMuted);
}

export function cleanupMediaTransports() {
  closeTransports();

  for (const [requestId, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error("Media request was cancelled"));
    pendingRequests.delete(requestId);
  }
}
