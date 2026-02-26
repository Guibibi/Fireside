import { onMessage, send } from "../ws";
import { isObject } from "./codecs";
import {
  consumerIdByProducerId,
  incrementRequestCounter,
  initializedForChannelId,
  initializingForChannelId,
  pendingRequests,
  producerRoutingModeById,
  producerSourceById,
  producerUsernameById,
  remoteVideoTilesByProducerId,
  setSignalListenerInitialized,
  signalListenerInitialized,
} from "./state";
import type { MediaSignalPayload, TransportOptions } from "./types";
import { notifyVideoTilesSubscribers } from "./subscriptions";
import { disposeRemoteConsumer, queueOrConsumeProducer } from "./consumers";

export function toMediaSignalPayload(value: unknown): MediaSignalPayload | null {
  if (!isObject(value)) {
    return null;
  }

  return value as MediaSignalPayload;
}

export function nextRequestId(): string {
  const counter = incrementRequestCounter();
  return `media-${Date.now()}-${counter}`;
}

export function ensureSignalListener() {
  if (signalListenerInitialized) {
    return;
  }

  setSignalListenerInitialized(true);
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
      if (payload.username) {
        producerUsernameById.set(payload.producer_id, payload.username);
      }
      if (payload.source) {
        producerSourceById.set(payload.producer_id, payload.source);
      }
      if (payload.routing_mode) {
        producerRoutingModeById.set(payload.producer_id, payload.routing_mode);
      }
      queueOrConsumeProducer(
        msg.channel_id,
        payload.producer_id,
        payload.kind,
        payload.source,
        payload.routing_mode,
        payload.username,
      );
      return;
    }

    if (payload.action === "producer_closed" && payload.producer_id) {
      producerUsernameById.delete(payload.producer_id);
      producerSourceById.delete(payload.producer_id);
      producerRoutingModeById.delete(payload.producer_id);
      if (remoteVideoTilesByProducerId.delete(payload.producer_id)) {
        notifyVideoTilesSubscribers();
      }
      const consumerId = consumerIdByProducerId.get(payload.producer_id);
      if (consumerId) {
        disposeRemoteConsumer(consumerId);
      }
    }
  });
}

export function requestMediaSignal(channelId: string, action: string, extra: Record<string, unknown> = {}): Promise<MediaSignalPayload> {
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

export function toTransportOptions(payload: MediaSignalPayload): TransportOptions {
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

export function reportVoiceActivity(channelId: string, speaking: boolean) {
  send({
    type: "voice_activity",
    channel_id: channelId,
    speaking,
  });
}

export function reportVoiceMuteState(channelId: string, micMuted: boolean, speakerMuted: boolean) {
  send({
    type: "voice_mute_state",
    channel_id: channelId,
    mic_muted: micMuted,
    speaker_muted: speakerMuted,
  });
}

export function reportNativeSenderDiagnostic(channelId: string, event: string, detail?: string) {
  send({
    type: "media_signal",
    channel_id: channelId,
    payload: {
      action: "client_diagnostic",
      event,
      detail,
    },
  });
}

export function reportCodecDecision(
  channelId: string,
  codecRequested: string,
  codecNegotiated: string,
  codecFallbackReason: string,
) {
  reportNativeSenderDiagnostic(
    channelId,
    "screen_share_codec_decision",
    `codec_requested=${codecRequested};codec_negotiated=${codecNegotiated};codec_fallback_reason=${codecFallbackReason}`,
  );
}
