// This file re-exports from the media/ module directory for backward compatibility.
// New code should import from "./media" or "./media/index" directly.

export type {
  AudioDeviceInventory,
  AudioDeviceOption,
  CameraActionResult,
  CameraDeviceOption,
  CameraStateSnapshot,
  RemoteVideoTile,
  RoutingMode,
  TransportHealthState,
} from "./media/index";

export {
  cleanupMediaTransports,
  initializeMediaTransports,
  isSpeakerSelectionSupported,
  listAudioDevices,
  listCameraDevices,
  localCameraEnabled,
  localCameraError,
  localCameraStream,
  remoteVideoTiles,
  resetPreferredAudioDevices,
  retryAudioPlayback,
  setMicrophoneMuted,
  setPreferredCameraDevice,
  setPreferredMicrophoneDevice,
  setPreferredSpeakerDevice,
  setSpeakersMuted,
  startLocalCameraProducer,
  stopLocalCameraProducer,
  subscribeCameraState,
  subscribeAudioPlaybackError,
  subscribeTransportHealth,
  subscribeVideoTiles,
} from "./media/index";
