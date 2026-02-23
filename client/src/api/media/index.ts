// Re-export public types
export type {
  AudioDeviceInventory,
  AudioDeviceOption,
  CameraActionResult,
  CameraDeviceOption,
  CameraStateSnapshot,
  RemoteVideoTile,
  RoutingMode,
  ScreenShareStartOptions,
  ScreenShareStateSnapshot,
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
  localScreenShareEnabled,
  localScreenShareError,
  localScreenShareStream,
  startLocalCameraProducer,
  startLocalScreenProducer,
  stopLocalCameraProducer,
  stopLocalScreenProducer,
} from "./producers";

// Re-export subscription functions
export {
  remoteVideoTiles,
  subscribeAudioPlaybackError,
  subscribeCameraState,
  subscribeScreenState,
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
