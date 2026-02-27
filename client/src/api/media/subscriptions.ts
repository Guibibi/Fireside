import {
  audioPlaybackErrorSubscribers,
  cameraEnabled,
  cameraError,
  cameraStateSubscribers,
  cameraStream,
  remoteVideoTilesByProducerId,
  transportHealthState,
  transportHealthSubscribers,
  videoTilesSubscribers,
} from "./state";
import type { CameraStateSnapshot, RemoteVideoTile, TransportHealthState } from "./types";

export function videoTilesSnapshot(): RemoteVideoTile[] {
  return Array.from(remoteVideoTilesByProducerId.values()).sort((left, right) => {
    const userOrder = left.username.localeCompare(right.username);
    if (userOrder !== 0) {
      return userOrder;
    }

    return left.producerId.localeCompare(right.producerId);
  });
}

export function notifyVideoTilesSubscribers() {
  const snapshot = videoTilesSnapshot();
  for (const subscriber of videoTilesSubscribers) {
    subscriber(snapshot);
  }
}

export function cameraStateSnapshot(): CameraStateSnapshot {
  return {
    enabled: cameraEnabled,
    error: cameraError,
    stream: cameraStream,
  };
}

export function notifyCameraStateSubscribers() {
  const snapshot = cameraStateSnapshot();
  for (const subscriber of cameraStateSubscribers) {
    subscriber(snapshot);
  }
}

export function clearRemoteVideoTiles() {
  if (remoteVideoTilesByProducerId.size === 0) {
    return;
  }

  remoteVideoTilesByProducerId.clear();
  notifyVideoTilesSubscribers();
}

export function remoteVideoTiles(): RemoteVideoTile[] {
  return videoTilesSnapshot();
}

export function subscribeVideoTiles(subscriber: (tiles: RemoteVideoTile[]) => void): () => void {
  videoTilesSubscribers.add(subscriber);
  subscriber(videoTilesSnapshot());

  return () => {
    videoTilesSubscribers.delete(subscriber);
  };
}

export function subscribeCameraState(subscriber: (snapshot: CameraStateSnapshot) => void): () => void {
  cameraStateSubscribers.add(subscriber);
  subscriber(cameraStateSnapshot());

  return () => {
    cameraStateSubscribers.delete(subscriber);
  };
}

export function notifyTransportHealthSubscribers() {
  const state = transportHealthState;
  for (const subscriber of transportHealthSubscribers) {
    subscriber(state);
  }
}

export function subscribeTransportHealth(subscriber: (state: TransportHealthState) => void): () => void {
  transportHealthSubscribers.add(subscriber);
  subscriber(transportHealthState);

  return () => {
    transportHealthSubscribers.delete(subscriber);
  };
}

export function notifyAudioPlaybackError(username: string | undefined) {
  for (const subscriber of audioPlaybackErrorSubscribers) {
    subscriber(username);
  }
}

export function subscribeAudioPlaybackError(subscriber: (username: string | undefined) => void): () => void {
  audioPlaybackErrorSubscribers.add(subscriber);
  return () => { audioPlaybackErrorSubscribers.delete(subscriber); };
}
