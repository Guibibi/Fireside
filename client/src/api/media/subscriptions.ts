import {
  cameraEnabled,
  cameraError,
  cameraStateSubscribers,
  cameraStream,
  remoteVideoTilesByProducerId,
  screenEnabled,
  screenError,
  screenRoutingMode,
  screenStateSubscribers,
  screenStream,
  transportHealthState,
  transportHealthSubscribers,
  videoTilesSubscribers,
} from "./state";
import type { CameraStateSnapshot, RemoteVideoTile, ScreenShareStateSnapshot, TransportHealthState } from "./types";

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

export function screenStateSnapshot(): ScreenShareStateSnapshot {
  return {
    enabled: screenEnabled,
    error: screenError,
    stream: screenStream,
    routingMode: screenRoutingMode,
  };
}

export function notifyScreenStateSubscribers() {
  const snapshot = screenStateSnapshot();
  for (const subscriber of screenStateSubscribers) {
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

export function subscribeScreenState(subscriber: (snapshot: ScreenShareStateSnapshot) => void): () => void {
  screenStateSubscribers.add(subscriber);
  subscriber(screenStateSnapshot());

  return () => {
    screenStateSubscribers.delete(subscriber);
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
