import {
  preferredAudioInputDeviceId,
  preferredCameraDeviceId,
  voiceEchoCancellationEnabled,
} from "../../stores/settings";

export function audioInputConstraint(deviceId: string | null = preferredAudioInputDeviceId()): MediaTrackConstraints | boolean {
  const constraints: MediaTrackConstraints = {};
  const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.();

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  if (supportedConstraints?.noiseSuppression) {
    constraints.noiseSuppression = false;
  }

  if (supportedConstraints?.echoCancellation) {
    constraints.echoCancellation = voiceEchoCancellationEnabled();
  }

  if (supportedConstraints?.channelCount) {
    constraints.channelCount = 1;
  }

  if (Object.keys(constraints).length === 0) {
    return true;
  }

  return constraints;
}

export function cameraInputConstraint(deviceId: string | null = preferredCameraDeviceId()): MediaTrackConstraints | boolean {
  const selectedDeviceId = deviceId;
  if (!selectedDeviceId) {
    return true;
  }

  return {
    deviceId: { exact: selectedDeviceId },
  };
}
