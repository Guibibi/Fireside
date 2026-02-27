// Re-export public types
export type {
  AudioDeviceInventory,
  AudioDeviceOption,
  CameraActionResult,
  CameraDeviceOption,
  CameraStateSnapshot,
  RemoteVideoTile,
  RoutingMode,
  TransportHealthState,
} from "./types";

// Re-export device functions
export {
  isSpeakerSelectionSupported,
  listAudioDevices,
  listCameraDevices,
  resetPreferredAudioDevices,
  setPreferredCameraDevice,
  setPreferredMicrophoneDevice,
  setPreferredSpeakerDevice,
} from "./devices";

// Re-export producer functions
export {
  localCameraEnabled,
  localCameraError,
  localCameraStream,
  startLocalCameraProducer,
  stopLocalCameraProducer,
} from "./producers";

// Re-export consumer functions
export { retryAudioPlayback } from "./consumers";

// Re-export subscription functions
export {
  remoteVideoTiles,
  subscribeAudioPlaybackError,
  subscribeCameraState,
  subscribeTransportHealth,
  subscribeVideoTiles,
} from "./subscriptions";

// Re-export transport functions
export {
  cleanupMediaTransports,
  initializeMediaTransports,
  setMicrophoneMuted,
  setSpeakersMuted,
} from "./transports";
