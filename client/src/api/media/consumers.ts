import type { Transport } from "mediasoup-client/types";
import {
  preferredAudioOutputDeviceId,
  voiceIncomingVolume,
} from "../../stores/settings";
import { clampUserVolume, getUserVolume } from "../../stores/userVolume";
import { isSpeakerSelectionSupported } from "./devices";
import { requestMediaSignal } from "./signaling";
import {
  consumerGainNodes,
  consumerIdByProducerId,
  consumerNormalizationNodes,
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
import { notifyAudioPlaybackError, notifyVideoTilesSubscribers } from "./subscriptions";
import type { MediaKind, MediaSource, RoutingMode, SinkableAudioElement } from "./types";

const consumeInFlight = new Set<string>();

function isConsumingProducer(producerId: string): boolean {
  return consumerIdByProducerId.has(producerId) || consumeInFlight.has(producerId);
}

function clampVoiceVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 100;
  }

  return Math.max(0, Math.min(100, Math.round(volume)));
}

function gainValueForVolume(localUserVolume: number): number {
  const normalizedIncoming = clampVoiceVolume(voiceIncomingVolume()) / 100;
  const normalizedLocalUser = clampUserVolume(localUserVolume) / 100;
  return normalizedIncoming * normalizedLocalUser;
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

  const sinkTarget = preferredAudioOutputDeviceId();
  if (sinkTarget && isSpeakerSelectionSupported()) {
    const sinkable = audio as SinkableAudioElement;
    void sinkable.setSinkId?.(sinkTarget).catch(() => undefined);
  }

  remoteAudioElements.set(consumerId, audio);
  return audio;
}

export async function retryAudioPlayback(): Promise<boolean> {
  if (remotePlaybackAudioContext && remotePlaybackAudioContext.state === "suspended") {
    await remotePlaybackAudioContext.resume();
    if (remotePlaybackAudioContext.state === "suspended") {
      return false;
    }
  }

  for (const audio of remoteAudioElements.values()) {
    try {
      await audio.play();
    } catch {
      return false;
    }
  }

  return true;
}

function maybeCloseRemotePlaybackAudioContext() {
  if (consumerSourceNodes.size > 0 || consumerNormalizationNodes.size > 0 || consumerGainNodes.size > 0) {
    return;
  }

  if (!remotePlaybackAudioContext || remotePlaybackAudioContext.state === "closed") {
    setRemotePlaybackAudioContext(null);
    return;
  }

  void remotePlaybackAudioContext.close().catch(() => undefined);
  setRemotePlaybackAudioContext(null);
}

function configureNormalizationNode(node: DynamicsCompressorNode, enabled: boolean) {
  if (enabled) {
    node.threshold.value = -24;
    node.knee.value = 20;
    node.ratio.value = 3;
    node.attack.value = 0.003;
    node.release.value = 0.25;
    return;
  }

  node.threshold.value = 0;
  node.knee.value = 0;
  node.ratio.value = 1;
  node.attack.value = 0.003;
  node.release.value = 0.25;
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

  const normalizationNode = consumerNormalizationNodes.get(consumerId);
  if (normalizationNode) {
    normalizationNode.disconnect();
    consumerNormalizationNodes.delete(consumerId);
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

  if (isConsumingProducer(producerId)) {
    return;
  }

  consumeInFlight.add(producerId);

  try {
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

      try {
        await requestMediaSignal(channelId, "media_resume_consumer", {
          consumer_id: consumer.id,
        });

        // Play the raw consumer track directly through the audio element.
        // WebView2's createMediaStreamSource() fails to produce audio when the
        // mediasoup consumer track starts in a muted state (before RTP arrives).
        audio.srcObject = new MediaStream([consumer.track]);

        const userVolUsername = producerUsernameById.get(description.producer_id);
        const volume = userVolUsername ? getUserVolume(userVolUsername) : 100;
        audio.volume = Math.min(1, gainValueForVolume(volume));

        try {
          await audio.play();
        } catch (playError) {
          console.warn("[media] Remote audio play() failed, retrying in 500ms", {
            consumerId: consumer.id,
            producerId: description.producer_id,
            error: playError,
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            await audio.play();
          } catch (retryError) {
            console.warn("[media] Remote audio play() retry also failed", {
              consumerId: consumer.id,
              producerId: description.producer_id,
              error: retryError,
            });
            notifyAudioPlaybackError(producerUsernameById.get(description.producer_id));
          }
        }
      } catch (error) {
        disposeRemoteConsumer(consumer.id);
        throw error;
      }
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

      try {
        await requestMediaSignal(channelId, "media_resume_consumer", {
          consumer_id: consumer.id,
        });
      } catch (error) {
        disposeRemoteConsumer(consumer.id);
        throw error;
      }
    }
  } finally {
    consumeInFlight.delete(producerId);
  }
}

export function updateUserGainNodes(username: string, volume: number) {
  const gain = gainValueForVolume(volume);
  for (const [consumerId, name] of consumerUsernameByConsumerId) {
    if (name === username) {
      const audio = remoteAudioElements.get(consumerId);
      if (audio) {
        audio.volume = Math.min(1, gain);
      }
    }
  }
}

export function updateIncomingVoiceGainNodes(volume: number) {
  const globalIncoming = clampVoiceVolume(volume) / 100;
  for (const [consumerId] of consumerUsernameByConsumerId) {
    const username = consumerUsernameByConsumerId.get(consumerId);
    const userVolume = username ? getUserVolume(username) : 100;
    const audio = remoteAudioElements.get(consumerId);
    if (audio) {
      audio.volume = Math.min(1, (clampUserVolume(userVolume) / 100) * globalIncoming);
    }
  }
}

export function updateVoiceNormalizationNodesEnabled(enabled: boolean) {
  for (const normalizationNode of consumerNormalizationNodes.values()) {
    configureNormalizationNode(normalizationNode, enabled);
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

  if (isConsumingProducer(producerId)) {
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
