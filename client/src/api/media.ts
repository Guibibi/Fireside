import { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/types";
import { onMessage, send } from "./ws";

interface IceParameters {
  usernameFragment: string;
  password: string;
  iceLite?: boolean;
}

interface IceCandidate {
  foundation: string;
  priority: number;
  address: string;
  ip: string;
  protocol: "udp" | "tcp";
  port: number;
  type: "host" | "srflx" | "prflx" | "relay";
  tcpType?: "active" | "passive" | "so";
}

interface DtlsParameters {
  role?: "auto" | "client" | "server";
  fingerprints: Array<{
    algorithm: "sha-1" | "sha-224" | "sha-256" | "sha-384" | "sha-512";
    value: string;
  }>;
}

interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

type MediaSignalAction =
  | "router_rtp_capabilities"
  | "webrtc_transport_created"
  | "webrtc_transport_connected"
  | "media_produced"
  | "new_producer"
  | "media_consumer_created"
  | "media_consumer_resumed"
  | "producer_closed"
  | "signal_error";

type MediaKind = "audio" | "video";

interface MediaConsumerDescription {
  id: string;
  producer_id: string;
  kind: MediaKind;
  rtp_parameters: unknown;
}

interface MediaSignalPayload {
  action?: MediaSignalAction | string;
  request_id?: string;
  message?: string;
  rtp_capabilities?: unknown;
  transport?: {
    id: string;
    ice_parameters: IceParameters;
    ice_candidates: IceCandidate[];
    dtls_parameters: DtlsParameters;
  };
  transport_id?: string;
  direction?: "send" | "recv";
  producer_id?: string;
  kind?: MediaKind;
  consumer?: MediaConsumerDescription;
  consumer_id?: string;
}

interface PendingRequest {
  resolve: (payload: MediaSignalPayload) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let device: Device | null = null;
let sendTransport: Transport | null = null;
let recvTransport: Transport | null = null;
let micProducer: Producer | null = null;
let micStream: MediaStream | null = null;
let micTrack: MediaStreamTrack | null = null;
let initializedForChannelId: string | null = null;
let initializingForChannelId: string | null = null;
let initializePromise: Promise<void> | null = null;
let signalListenerInitialized = false;
let requestCounter = 0;
let microphoneMuted = false;
let speakersMuted = false;

const remoteConsumers = new Map<string, Consumer>();
const consumerIdByProducerId = new Map<string, string>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const queuedProducerAnnouncements = new Map<string, MediaKind | undefined>();

const pendingRequests = new Map<string, PendingRequest>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toMediaSignalPayload(value: unknown): MediaSignalPayload | null {
  if (!isObject(value)) {
    return null;
  }

  return value as MediaSignalPayload;
}

function nextRequestId() {
  requestCounter += 1;
  return `media-${Date.now()}-${requestCounter}`;
}

function ensureSignalListener() {
  if (signalListenerInitialized) {
    return;
  }

  signalListenerInitialized = true;
  onMessage((msg) => {
    if (msg.type !== "media_signal") {
      return;
    }

    const payload = toMediaSignalPayload(msg.payload);
    if (!payload) {
      return;
    }

    if (payload.request_id) {
      const pending = pendingRequests.get(payload.request_id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      pendingRequests.delete(payload.request_id);

      if (payload.action === "signal_error") {
        pending.reject(new Error(payload.message ?? "Media signaling request failed"));
        return;
      }

      pending.resolve(payload);
      return;
    }

    if (msg.channel_id !== initializedForChannelId && msg.channel_id !== initializingForChannelId) {
      return;
    }

    if (payload.action === "new_producer" && payload.producer_id) {
      queueOrConsumeProducer(msg.channel_id, payload.producer_id, payload.kind);
      return;
    }

    if (payload.action === "producer_closed" && payload.producer_id) {
      const consumerId = consumerIdByProducerId.get(payload.producer_id);
      if (consumerId) {
        disposeRemoteConsumer(consumerId);
      }
    }
  });
}

function requestMediaSignal(channelId: string, action: string, extra: Record<string, unknown> = {}) {
  ensureSignalListener();

  const requestId = nextRequestId();

  return new Promise<MediaSignalPayload>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for media signaling response: ${action}`));
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timeoutId });

    send({
      type: "media_signal",
      channel_id: channelId,
      payload: {
        action,
        request_id: requestId,
        ...extra,
      },
    });
  });
}

function closeTransports() {
  micProducer?.close();
  micProducer = null;

  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  }

  if (micStream) {
    for (const track of micStream.getTracks()) {
      track.stop();
    }
    micStream = null;
  }

  for (const consumerId of remoteConsumers.keys()) {
    disposeRemoteConsumer(consumerId);
  }

  sendTransport?.close();
  recvTransport?.close();
  sendTransport = null;
  recvTransport = null;
  device = null;
  initializedForChannelId = null;
  initializingForChannelId = null;
  queuedProducerAnnouncements.clear();
}

function toTransportOptions(payload: MediaSignalPayload): TransportOptions {
  const transport = payload.transport;
  if (!transport) {
    throw new Error("Missing transport payload from server");
  }

  return {
    id: transport.id,
    iceParameters: transport.ice_parameters,
    iceCandidates: transport.ice_candidates,
    dtlsParameters: transport.dtls_parameters,
  };
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

function wireSendTransportProduce(channelId: string, transport: Transport) {
  transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
    requestMediaSignal(channelId, "media_produce", {
      kind,
      rtp_parameters: rtpParameters,
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

async function startLocalAudioProducer(channelId: string) {
  if (!sendTransport || micProducer) {
    return;
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const [audioTrack] = micStream.getAudioTracks();

  if (!audioTrack) {
    throw new Error("Microphone track was not available");
  }

  micTrack = audioTrack;
  micTrack.enabled = !microphoneMuted;

  const produced = await sendTransport.produce({
    track: micTrack,
    stopTracks: false,
  });

  produced.on("transportclose", () => {
    micProducer = null;
  });

  produced.on("trackended", () => {
    micProducer = null;
  });

  micProducer = produced;

  if (initializedForChannelId !== channelId) {
    micProducer.close();
    micProducer = null;
  }
}

function ensureAudioElement(consumerId: string): HTMLAudioElement {
  const existing = remoteAudioElements.get(consumerId);
  if (existing) {
    return existing;
  }

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.muted = speakersMuted;
  audio.style.display = "none";
  document.body.appendChild(audio);
  remoteAudioElements.set(consumerId, audio);
  return audio;
}

function disposeRemoteConsumer(consumerId: string) {
  const consumer = remoteConsumers.get(consumerId);
  if (consumer) {
    const producerId = consumer.producerId;
    consumer.close();
    remoteConsumers.delete(consumerId);
    if (producerId) {
      consumerIdByProducerId.delete(producerId);
    }
  }

  const audio = remoteAudioElements.get(consumerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(consumerId);
  }
}

async function consumeRemoteProducer(channelId: string, producerId: string) {
  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, undefined);
    return;
  }

  if (consumerIdByProducerId.has(producerId)) {
    return;
  }

  const response = await requestMediaSignal(channelId, "media_consume", {
    producer_id: producerId,
    rtp_capabilities: device.rtpCapabilities,
  });

  if (response.action !== "media_consumer_created" || !response.consumer) {
    throw new Error("Unexpected media_consume response from server");
  }

  const description = response.consumer;

  const consumer = await recvTransport.consume({
    id: description.id,
    producerId: description.producer_id,
    kind: description.kind,
    rtpParameters: description.rtp_parameters as Parameters<Transport["consume"]>[0]["rtpParameters"],
  });

  consumerIdByProducerId.set(description.producer_id, consumer.id);
  remoteConsumers.set(consumer.id, consumer);

  consumer.on("transportclose", () => {
    disposeRemoteConsumer(consumer.id);
  });

  if (description.kind === "audio") {
    const audio = ensureAudioElement(consumer.id);
    audio.srcObject = new MediaStream([consumer.track]);
    void audio.play().catch(() => undefined);
  }

  try {
    await requestMediaSignal(channelId, "media_resume_consumer", {
      consumer_id: consumer.id,
    });
  } catch (error) {
    disposeRemoteConsumer(consumer.id);
    throw error;
  }
}

function queueOrConsumeProducer(channelId: string, producerId: string, kind: MediaKind | undefined) {
  if (consumerIdByProducerId.has(producerId)) {
    return;
  }

  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, kind);
    return;
  }

  void consumeRemoteProducer(channelId, producerId).catch(() => {
    queuedProducerAnnouncements.set(producerId, kind);
  });
}

function flushQueuedProducerAnnouncements(channelId: string) {
  const queuedProducerIds = Array.from(queuedProducerAnnouncements.keys());
  queuedProducerAnnouncements.clear();

  for (const producerId of queuedProducerIds) {
    void consumeRemoteProducer(channelId, producerId).catch(() => {
      queuedProducerAnnouncements.set(producerId, undefined);
    });
  }
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

  initializePromise = (async () => {
    initializingForChannelId = channelId;
    closeTransports();

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

    device = nextDevice;
    sendTransport = nextSendTransport;
    recvTransport = nextRecvTransport;
    initializedForChannelId = channelId;
    initializingForChannelId = null;

    await startLocalAudioProducer(channelId);
    flushQueuedProducerAnnouncements(channelId);
  })();

  try {
    await initializePromise;
  } finally {
    if (initializedForChannelId !== channelId) {
      initializingForChannelId = null;
    }
    initializePromise = null;
  }
}

export function setMicrophoneMuted(muted: boolean) {
  microphoneMuted = muted;
  if (micTrack) {
    micTrack.enabled = !muted;
  }
}

export function setSpeakersMuted(muted: boolean) {
  speakersMuted = muted;
  for (const audio of remoteAudioElements.values()) {
    audio.muted = muted;
  }
}

export function cleanupMediaTransports() {
  closeTransports();

  for (const [requestId, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error("Media request was cancelled"));
    pendingRequests.delete(requestId);
  }
}
