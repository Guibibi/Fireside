import type { Transport } from "mediasoup-client/types";
import { preferredAudioOutputDeviceId } from "../../stores/settings";
import { clampUserVolume, getUserVolume } from "../../stores/userVolume";
import { isSpeakerSelectionSupported } from "./devices";
import { requestMediaSignal } from "./signaling";
import {
  consumerGainNodes,
  consumerIdByProducerId,
  consumerSourceNodes,
  consumerUsernameByConsumerId,
  device,
  initializedForChannelId,
  producerRoutingModeById,
  producerSourceById,
  producerUsernameById,
  queuedProducerAnnouncements,
  recvTransport,
  remotePlaybackAudioContext,
  remoteAudioElements,
  remoteConsumers,
  remoteVideoTilesByProducerId,
  setRemotePlaybackAudioContext,
  speakersMuted,
} from "./state";
import { notifyVideoTilesSubscribers } from "./subscriptions";
import type { MediaKind, MediaSource, RoutingMode, SinkableAudioElement } from "./types";

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

  const sinkTarget = preferredAudioOutputDeviceId();
  if (sinkTarget && isSpeakerSelectionSupported()) {
    const sinkable = audio as SinkableAudioElement;
    void sinkable.setSinkId?.(sinkTarget).catch(() => undefined);
  }

  remoteAudioElements.set(consumerId, audio);
  return audio;
}

function getOrCreateRemotePlaybackAudioContext(): AudioContext {
  if (remotePlaybackAudioContext && remotePlaybackAudioContext.state !== "closed") {
    return remotePlaybackAudioContext;
  }

  const nextContext = new AudioContext();
  setRemotePlaybackAudioContext(nextContext);
  void nextContext.resume().catch(() => undefined);
  return nextContext;
}

function maybeCloseRemotePlaybackAudioContext() {
  if (consumerSourceNodes.size > 0 || consumerGainNodes.size > 0) {
    return;
  }

  if (!remotePlaybackAudioContext || remotePlaybackAudioContext.state === "closed") {
    setRemotePlaybackAudioContext(null);
    return;
  }

  void remotePlaybackAudioContext.close().catch(() => undefined);
  setRemotePlaybackAudioContext(null);
}

export function disposeRemoteConsumer(consumerId: string) {
  const consumer = remoteConsumers.get(consumerId);
  if (consumer) {
    const producerId = consumer.producerId;
    consumer.close();
    remoteConsumers.delete(consumerId);
    if (producerId) {
      consumerIdByProducerId.delete(producerId);
      producerSourceById.delete(producerId);
      producerRoutingModeById.delete(producerId);
      producerUsernameById.delete(producerId);
      if (remoteVideoTilesByProducerId.delete(producerId)) {
        notifyVideoTilesSubscribers();
      }
    }
  }

  const sourceNode = consumerSourceNodes.get(consumerId);
  if (sourceNode) {
    sourceNode.disconnect();
    consumerSourceNodes.delete(consumerId);
  }

  const gainNode = consumerGainNodes.get(consumerId);
  if (gainNode) {
    gainNode.disconnect();
    consumerGainNodes.delete(consumerId);
  }

  consumerUsernameByConsumerId.delete(consumerId);
  maybeCloseRemotePlaybackAudioContext();

  const audio = remoteAudioElements.get(consumerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(consumerId);
  }
}

export async function consumeRemoteProducer(channelId: string, producerId: string) {
  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, {
      kind: undefined,
      source: producerSourceById.get(producerId),
      routingMode: producerRoutingModeById.get(producerId),
      username: producerUsernameById.get(producerId),
    });
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

  consumer.on("trackended", () => {
    disposeRemoteConsumer(consumer.id);
  });

  if (description.kind === "audio") {
    const audio = ensureAudioElement(consumer.id);
    const username = producerUsernameById.get(description.producer_id);
    if (username) {
      consumerUsernameByConsumerId.set(consumer.id, username);
    }

    audio.srcObject = new MediaStream([consumer.track]);
    void audio.play().catch(() => undefined);
  } else {
    const username = producerUsernameById.get(description.producer_id) ?? "Unknown";
    const source = producerSourceById.get(description.producer_id) === "screen" ? "screen" : "camera";
    const routingMode = producerRoutingModeById.get(description.producer_id) ?? "sfu";
    remoteVideoTilesByProducerId.set(description.producer_id, {
      producerId: description.producer_id,
      username,
      stream: new MediaStream([consumer.track]),
      source,
      routingMode,
    });
    notifyVideoTilesSubscribers();
  }

  try {
    await requestMediaSignal(channelId, "media_resume_consumer", {
      consumer_id: consumer.id,
    });

    if (description.kind === "audio") {
      const audio = remoteAudioElements.get(consumer.id);
      if (audio && audio.srcObject) {
        const audioCtx = getOrCreateRemotePlaybackAudioContext();
        const stream = audio.srcObject as MediaStream;
        const source = audioCtx.createMediaStreamSource(stream);
        consumerSourceNodes.set(consumer.id, source);

        const gainNode = audioCtx.createGain();
        consumerGainNodes.set(consumer.id, gainNode);

        const username = producerUsernameById.get(description.producer_id);
        const volume = username ? getUserVolume(username) : 100;
        gainNode.gain.value = volume / 100;

        const destination = audioCtx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(destination);

        audio.srcObject = destination.stream;
      }
    }
  } catch (error) {
    disposeRemoteConsumer(consumer.id);
    throw error;
  }
}

export function updateUserGainNodes(username: string, volume: number) {
  const gain = clampUserVolume(volume) / 100;
  for (const [consumerId, gainNode] of consumerGainNodes) {
    if (consumerUsernameByConsumerId.get(consumerId) === username) {
      gainNode.gain.value = gain;
    }
  }
}

export function queueOrConsumeProducer(
  channelId: string,
  producerId: string,
  kind: MediaKind | undefined,
  source: MediaSource | undefined,
  routingMode: RoutingMode | undefined,
  username?: string,
) {
  if (username) {
    producerUsernameById.set(producerId, username);
  }

  if (source) {
    producerSourceById.set(producerId, source);
  }

  if (routingMode) {
    producerRoutingModeById.set(producerId, routingMode);
  }

  if (consumerIdByProducerId.has(producerId)) {
    return;
  }

  if (!device || !recvTransport || initializedForChannelId !== channelId) {
    queuedProducerAnnouncements.set(producerId, { kind, source, routingMode, username });
    return;
  }

  void consumeRemoteProducer(channelId, producerId).catch(() => {
    queuedProducerAnnouncements.set(producerId, { kind, source, routingMode, username });
  });
}

export function flushQueuedProducerAnnouncements(channelId: string) {
  const queuedProducerEntries = Array.from(queuedProducerAnnouncements.entries());
  queuedProducerAnnouncements.clear();

  for (const [producerId, queued] of queuedProducerEntries) {
    if (queued.username) {
      producerUsernameById.set(producerId, queued.username);
    }

    if (queued.source) {
      producerSourceById.set(producerId, queued.source);
    }

    if (queued.routingMode) {
      producerRoutingModeById.set(producerId, queued.routingMode);
    }

    void consumeRemoteProducer(channelId, producerId).catch(() => {
      queuedProducerAnnouncements.set(producerId, {
        kind: queued.kind,
        source: queued.source,
        routingMode: queued.routingMode,
        username: queued.username,
      });
    });
  }
}
