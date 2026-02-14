import { For, Show, createEffect, createSignal, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { del, get, post } from "../api/http";
import {
  cleanupMediaTransports,
  initializeMediaTransports,
  type ScreenShareStartOptions,
  startLocalCameraProducer,
  startLocalScreenProducer,
  stopLocalCameraProducer,
  stopLocalScreenProducer,
  setMicrophoneMuted,
  setSpeakersMuted,
} from "../api/media";
import {
  listNativeCaptureSources,
  nativeCodecCapabilities,
  nativeCaptureStatus,
  type NativeCodecCapability,
  type NativeCaptureStatus,
  type NativeCaptureSource,
} from "../api/nativeCapture";
import { connect, onClose, onMessage, send } from "../api/ws";
import {
  activeChannelId,
  Channel,
  clearUnread,
  incrementUnread,
  removeUnreadChannel,
  setActiveChannelId,
  unreadCount,
} from "../stores/chat";
import {
  preferredScreenShareBitrateMode,
  preferredScreenShareCustomBitrateKbps,
  preferredScreenShareFps,
  preferredScreenShareResolution,
  preferredScreenShareSourceKind,
  savePreferredScreenShareBitrateMode,
  savePreferredScreenShareCustomBitrateKbps,
  savePreferredScreenShareEncoderBackend,
  savePreferredScreenShareCodecPreference,
  savePreferredScreenShareCodecStrictMode,
  savePreferredScreenShareFps,
  savePreferredScreenShareResolution,
  savePreferredScreenShareSourceKind,
  type ScreenShareBitrateMode,
  type ScreenShareCodecPreference,
  type ScreenShareEncoderBackend,
  type ScreenShareFps,
  type ScreenShareResolution,
  preferredScreenShareEncoderBackend,
  preferredScreenShareCodecPreference,
  preferredScreenShareCodecStrictMode,
} from "../stores/settings";
import { errorMessage } from "../utils/error";
import { isTauriRuntime } from "../utils/platform";
import {
  applyVoiceJoined,
  applyVoiceLeft,
  applyVoiceSpeaking,
  applyVoiceSnapshot,
  clearVoiceRejoinNotice,
  clearVoiceCameraError,
  cameraEnabled,
  cameraError,
  isVoiceMemberSpeaking,
  joinedVoiceChannelId,
  micMuted,
  participantsByChannel,
  resetVoiceMediaState,
  removeVoiceChannelState,
  setJoinedVoiceChannel,
  setVoiceCameraError,
  setVoiceActionState,
  speakerMuted,
  startCameraStateSubscription,
  startConnectionStatusSubscription,
  startScreenStateSubscription,
  startVideoTilesSubscription,
  stopConnectionStatusSubscription,
  screenShareEnabled,
  screenShareError,
  screenShareRoutingMode,
  showVoiceRejoinNotice,
  toggleMicMuted,
  toggleSpeakerMuted,
  voiceConnectionStatus,
  voiceRejoinNotice,
  voiceActionState,
} from "../stores/voice";
import AsyncContent from "./AsyncContent";
import UserSettingsDock from "./UserSettingsDock";
import Modal from "./Modal";

async function fetchChannels() {
  return get<Channel[]>("/channels");
}

function ChannelRow(props: {
  channel: Channel;
  prefix: string;
  isActive: boolean;
  isVoiceConnected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  disabled: boolean;
  badge?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <li class="channel-row">
      <div class="channel-row-main">
        <button
          type="button"
          class={`channel-item${props.isActive ? " is-active" : ""}${props.isVoiceConnected ? " is-voice-connected" : ""}`}
          onClick={props.onSelect}
        >
          <span class="channel-prefix">{props.prefix}</span>
          <span class="channel-name">{props.channel.name}</span>
          {props.badge}
        </button>
        <button
          type="button"
          class="channel-delete"
          onClick={props.onDelete}
          disabled={props.disabled}
          title="Delete channel"
        >
          x
        </button>
      </div>
      {props.children}
    </li>
  );
}

export default function ChannelList() {
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [isSaving, setIsSaving] = createSignal(false);
  const [channelCreateOpenKind, setChannelCreateOpenKind] = createSignal<Channel["kind"] | null>(null);
  const [channelCreateName, setChannelCreateName] = createSignal("");
  const [channelCreateDescription, setChannelCreateDescription] = createSignal("");
  const [loadError, setLoadError] = createSignal("");
  const [toastError, setToastError] = createSignal("");
  const [cameraActionPending, setCameraActionPending] = createSignal(false);
  const [screenActionPending, setScreenActionPending] = createSignal(false);
  const [screenShareModalOpen, setScreenShareModalOpen] = createSignal(false);
  const [nativeSourcesLoading, setNativeSourcesLoading] = createSignal(false);
  const [nativeSourcesError, setNativeSourcesError] = createSignal("");
  const [nativeSources, setNativeSources] = createSignal<NativeCaptureSource[]>([]);
  const [selectedNativeSourceId, setSelectedNativeSourceId] = createSignal<string | null>(null);
  const [screenSharePreviewStream, setScreenSharePreviewStream] = createSignal<MediaStream | null>(null);
  const [screenSharePreviewError, setScreenSharePreviewError] = createSignal("");
  const [nativeCodecSupport, setNativeCodecSupport] = createSignal<Record<string, NativeCodecCapability> | null>(null);
  const [nativeSenderMetrics, setNativeSenderMetrics] = createSignal<NativeCaptureStatus["native_sender"] | null>(null);
  const [pulsingByChannel, setPulsingByChannel] = createSignal<Record<string, boolean>>({});
  const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const tauriRuntime = isTauriRuntime();
  const nativeDebugEnabled = tauriRuntime && (
    import.meta.env.DEV
    || window.localStorage.getItem("yankcord_debug_native_sender") === "1"
  );
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let screenSharePreviewVideoRef: HTMLVideoElement | undefined;
  let channelCreateNameInputRef: HTMLInputElement | undefined;

  function selectedScreenShareSourceKind(): "screen" | "window" | "application" {
    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;
    if (selected) {
      return selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window";
    }

    return preferredScreenShareSourceKind();
  }

  function stopScreenSharePreview() {
    const stream = screenSharePreviewStream();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setScreenSharePreviewStream(null);
    }

    setScreenSharePreviewError("");
  }

  function supportsSelectedCodecPreference(): boolean {
    const preference = preferredScreenShareCodecPreference();
    if (preference === "auto") {
      return true;
    }

    const capabilities = nativeCodecSupport();
    if (!capabilities) {
      return true;
    }

    const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
    return capability?.available ?? false;
  }

  function codecPreferenceDisabled(preference: ScreenShareCodecPreference): boolean {
    if (preference === "auto") {
      return false;
    }

    const capabilities = nativeCodecSupport();
    if (!capabilities) {
      return false;
    }

    const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
    return !(capability?.available ?? false);
  }

  function codecPreferenceUnavailableReason(preference: ScreenShareCodecPreference): string | undefined {
    if (preference === "auto") {
      return undefined;
    }

    const capabilities = nativeCodecSupport();
    if (!capabilities) {
      return undefined;
    }

    const capability = capabilities[`video/${preference.toUpperCase()}`] ?? null;
    if (capability?.available) {
      return undefined;
    }

    return friendlyCodecUnavailableReason(capability?.detail, preference);
  }

  function friendlyCodecUnavailableReason(
    detail: string | null | undefined,
    preference: ScreenShareCodecPreference,
  ): string {
    const codecLabel = preference.toUpperCase();
    if (!detail) {
      return `${codecLabel} unavailable on this client`;
    }

    const normalized = detail.toLowerCase();
    if (normalized.includes("failed to execute ffmpeg encoder probe") || normalized.includes("failed to spawn ffmpeg")) {
      return `${codecLabel} unavailable: FFmpeg is missing or not executable`;
    }
    if (normalized.includes("libaom-av1 encoder is missing")) {
      return "AV1 unavailable: FFmpeg is missing libaom-av1";
    }
    if (normalized.includes("libvpx-vp9 encoder is missing")) {
      return "VP9 unavailable: FFmpeg is missing libvpx-vp9";
    }
    if (normalized.includes("libvpx vp8 encoder is missing")) {
      return "VP8 unavailable: FFmpeg is missing libvpx";
    }
    if (normalized.includes("h264_nvenc encoder is missing")) {
      return "H264 NVENC unavailable: GPU/driver/FFmpeg support missing";
    }
    if (normalized.includes("native-nvenc feature")) {
      return "H264 NVENC unavailable: build missing native-nvenc feature";
    }

    return `${codecLabel} unavailable on this client`;
  }

  function previewResolutionConstraints() {
    const resolution = preferredScreenShareResolution();
    if (resolution === "720p") {
      return { width: { ideal: 1280 }, height: { ideal: 720 } };
    }
    if (resolution === "1080p") {
      return { width: { ideal: 1920 }, height: { ideal: 1080 } };
    }
    if (resolution === "1440p") {
      return { width: { ideal: 2560 }, height: { ideal: 1440 } };
    }

    return { width: { ideal: 3840 }, height: { ideal: 2160 } };
  }

  async function startScreenSharePreview() {
    setScreenSharePreviewError("");
    stopScreenSharePreview();

    const sourceKind = selectedScreenShareSourceKind();
    const displaySurface = sourceKind === "screen" ? "monitor" : "window";

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...previewResolutionConstraints(),
          frameRate: { ideal: preferredScreenShareFps(), max: preferredScreenShareFps() },
          displaySurface,
        },
        audio: false,
      });

      const [track] = stream.getVideoTracks();
      if (track) {
        track.addEventListener("ended", () => {
          if (screenSharePreviewStream() === stream) {
            stopScreenSharePreview();
          }
        });
      }

      setScreenSharePreviewStream(stream);
    } catch (error) {
      setScreenSharePreviewError(errorMessage(error, "Failed to start preview"));
    }
  }

  function autoBitrateKbps(resolution: ScreenShareResolution, fps: ScreenShareFps): number {
    const at60 = fps >= 60;
    if (resolution === "720p") {
      return at60 ? 6000 : 4500;
    }

    if (resolution === "1080p") {
      return at60 ? 12000 : 8000;
    }

    if (resolution === "1440p") {
      return at60 ? 18000 : 12000;
    }

    return at60 ? 30000 : 20000;
  }

  function manualBitrateKbps(mode: ScreenShareBitrateMode, resolution: ScreenShareResolution): number {
    if (mode === "balanced") {
      if (resolution === "720p") {
        return 4000;
      }
      if (resolution === "1080p") {
        return 7000;
      }
      if (resolution === "1440p") {
        return 10000;
      }

      return 14000;
    }

    if (mode === "high") {
      if (resolution === "720p") {
        return 5500;
      }
      if (resolution === "1080p") {
        return 10000;
      }
      if (resolution === "1440p") {
        return 15000;
      }

      return 22000;
    }

    if (mode === "ultra") {
      if (resolution === "720p") {
        return 7000;
      }
      if (resolution === "1080p") {
        return 14000;
      }
      if (resolution === "1440p") {
        return 20000;
      }

      return 30000;
    }

    return autoBitrateKbps(resolution, preferredScreenShareFps());
  }

  function selectedScreenShareBitrateKbps(): number {
    const mode = preferredScreenShareBitrateMode();
    const resolution = preferredScreenShareResolution();
    const fps = preferredScreenShareFps();
    if (mode === "auto") {
      return autoBitrateKbps(resolution, fps);
    }

    if (mode === "custom") {
      return preferredScreenShareCustomBitrateKbps();
    }

    return manualBitrateKbps(mode, resolution);
  }

  function buildScreenShareOptions(): ScreenShareStartOptions {
    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;
    const sourceKind = selected
      ? (selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window")
      : preferredScreenShareSourceKind();

    return {
      resolution: preferredScreenShareResolution(),
      fps: preferredScreenShareFps(),
      bitrateKbps: selectedScreenShareBitrateKbps(),
      sourceKind,
      encoderBackend: preferredScreenShareEncoderBackend(),
      codecPreference: preferredScreenShareCodecPreference(),
      strictCodec: preferredScreenShareCodecStrictMode(),
      sourceId: selected?.id,
      sourceTitle: selected?.title,
    };
  }

  async function loadNativeCaptureSources() {
    if (!tauriRuntime) {
      return;
    }

    setNativeSourcesLoading(true);
    setNativeSourcesError("");

    try {
      const sources = await listNativeCaptureSources();
      setNativeSources(sources);

      const selectedId = selectedNativeSourceId();
      if (selectedId && sources.some((source) => source.id === selectedId)) {
        return;
      }

      const preferredKind = preferredScreenShareSourceKind();
      const preferredSource = sources.find((source) => source.kind === preferredKind);
      setSelectedNativeSourceId(preferredSource?.id ?? sources[0]?.id ?? null);
    } catch (error) {
      setNativeSources([]);
      setSelectedNativeSourceId(null);
      setNativeSourcesError(errorMessage(error, "Failed to load native capture sources"));
    } finally {
      setNativeSourcesLoading(false);
    }
  }

  async function loadNativeCodecSupport() {
    if (!tauriRuntime) {
      return;
    }

    try {
      const capabilities = await nativeCodecCapabilities();
      const indexed = capabilities.reduce<Record<string, NativeCodecCapability>>((acc, capability) => {
        acc[capability.mime_type] = capability;
        return acc;
      }, {});
      setNativeCodecSupport(indexed);
    } catch {
      setNativeCodecSupport(null);
    }
  }

  function nativeSourceLabel(source: NativeCaptureSource) {
    const appName = source.app_name?.trim();
    const size = source.width && source.height ? `${source.width}x${source.height}` : null;
    if (appName && size) {
      return `${source.title} (${appName}, ${size})`;
    }

    if (appName) {
      return `${source.title} (${appName})`;
    }

    if (size) {
      return `${source.title} (${size})`;
    }

    return source.title;
  }

  function showErrorToast(message: string) {
    setToastError(message);
    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toastTimer = null;
      setToastError("");
    }, 3500);
  }

  function closeScreenShareModal() {
    stopScreenSharePreview();
    setScreenShareModalOpen(false);
  }

  function ensureValidActiveChannel(nextChannels: Channel[]) {
    const selected = activeChannelId();
    const selectedStillExists = selected ? nextChannels.some((channel) => channel.id === selected) : false;

    if (selectedStillExists) {
      return;
    }

    setActiveChannelId(nextChannels[0]?.id ?? null);
  }

  function joinVoiceChannel(channelId: string) {
    if (voiceActionState() !== "idle" || joinedVoiceChannelId() === channelId) {
      return;
    }

    setVoiceActionState("joining");
    send({ type: "join_voice", channel_id: channelId });
  }

  function leaveVoiceChannel() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || voiceActionState() !== "idle") {
      return;
    }

    setVoiceActionState("leaving");
    send({ type: "leave_voice", channel_id: channelId });
  }

  function handleToggleMicMuted() {
    const nextMuted = !micMuted();
    toggleMicMuted();
    setMicrophoneMuted(nextMuted);
  }

  function handleToggleSpeakerMuted() {
    const nextMuted = !speakerMuted();
    toggleSpeakerMuted();
    setSpeakersMuted(nextMuted);
  }

  async function handleToggleCamera() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || cameraActionPending()) {
      return;
    }

    setCameraActionPending(true);
    clearVoiceCameraError();

    try {
      const result = cameraEnabled()
        ? await stopLocalCameraProducer(channelId)
        : await startLocalCameraProducer(channelId);

      if (!result.ok && result.error) {
        setVoiceCameraError(result.error);
        showErrorToast(result.error);
      }
    } finally {
      setCameraActionPending(false);
    }
  }

  async function startScreenShareWithOptions(channelId: string, options?: ScreenShareStartOptions) {
    setScreenActionPending(true);

    try {
      const result = await startLocalScreenProducer(channelId, options);
      if (!result.ok && result.error) {
        showErrorToast(result.error);
      }
      return result;
    } finally {
      setScreenActionPending(false);
    }
  }

  async function handleConfirmTauriScreenShare() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || screenActionPending()) {
      return;
    }

    const selected = nativeSources().find((source) => source.id === selectedNativeSourceId()) ?? null;
    if (selected) {
      savePreferredScreenShareSourceKind(
        selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window",
      );
    }

    const result = await startScreenShareWithOptions(channelId, buildScreenShareOptions());
    if (result.ok) {
      closeScreenShareModal();
    }
  }

  async function handleToggleScreenShare() {
    const channelId = joinedVoiceChannelId();
    if (!channelId || screenActionPending()) {
      return;
    }

    try {
      if (screenShareEnabled()) {
        setScreenActionPending(true);
        const result = await stopLocalScreenProducer(channelId);
        if (!result.ok && result.error) {
          showErrorToast(result.error);
        }
        return;
      }

      if (tauriRuntime) {
        await loadNativeCaptureSources();
        await loadNativeCodecSupport();
        setScreenShareModalOpen(true);
        return;
      }

      await startScreenShareWithOptions(channelId);
    } finally {
      setScreenActionPending(false);
    }
  }

  function selectChannel(channel: Channel) {
    if (channel.kind === "voice") {
      joinVoiceChannel(channel.id);
      return;
    }

    setActiveChannelId(channel.id);
    clearUnread(channel.id);
  }

  function clearActiveChannelUnread() {
    const selected = activeChannelId();
    if (selected) {
      clearUnread(selected);
    }
  }

  function formatUnreadBadge(channelId: string) {
    const count = unreadCount(channelId);
    if (count <= 0) {
      return "";
    }

    return count > 99 ? "99+" : String(count);
  }

  function voiceMembers(channelId: string) {
    return participantsByChannel()[channelId] ?? [];
  }

  function pulseBadge(channelId: string) {
    const existingTimer = pulseTimers.get(channelId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    setPulsingByChannel((current) => ({ ...current, [channelId]: true }));

    const timer = setTimeout(() => {
      pulseTimers.delete(channelId);
      setPulsingByChannel((current) => {
        const next = { ...current };
        delete next[channelId];
        return next;
      });
    }, 420);

    pulseTimers.set(channelId, timer);
  }

  async function loadInitialChannels() {
    setIsLoading(true);
    setLoadError("");
    try {
      const loaded = await fetchChannels();
      const sorted = [...loaded].sort((a, b) => a.position - b.position);
      setChannels(sorted);
      ensureValidActiveChannel(sorted);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load channels"));
    } finally {
      setIsLoading(false);
    }
  }

  function openCreateChannel(kind: Channel["kind"]) {
    if (isSaving()) {
      return;
    }

    setChannelCreateOpenKind(kind);
    setChannelCreateName("");
    setChannelCreateDescription("");
  }

  function closeCreateChannel() {
    setChannelCreateOpenKind(null);
    setChannelCreateName("");
    setChannelCreateDescription("");
  }

  async function handleCreateChannel(kind: Channel["kind"], rawName: string, rawDescription: string) {
    if (isSaving()) {
      return;
    }

    const trimmed = rawName.trim();
    const trimmedDescription = rawDescription.trim();
    if (!trimmed) {
      showErrorToast("Channel name is required");
      return;
    }

    setIsSaving(true);
    setLoadError("");
    try {
      await post<Channel>("/channels", {
        name: trimmed,
        description: trimmedDescription.length > 0 ? trimmedDescription : null,
        kind,
      });
      closeCreateChannel();
    } catch (error) {
      showErrorToast(errorMessage(error, "Failed to create channel"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteChannel(channel: Channel) {
    if (isSaving()) {
      return;
    }

    const confirmed = window.confirm(`Delete #${channel.name}?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    try {
      await del<{ deleted: true }>(`/channels/${channel.id}`);
    } catch (error) {
      showErrorToast(errorMessage(error, "Failed to delete channel"));
    } finally {
      setIsSaving(false);
    }
  }

  onMount(() => {
    connect();
    startConnectionStatusSubscription();
    void loadInitialChannels();

    const handleWindowFocus = () => {
      clearActiveChannelUnread();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        clearActiveChannelUnread();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const unsubscribe = onMessage((msg) => {
      if (msg.type === "channel_created") {
        setChannels((current) => {
          const next = current.some((channel) => channel.id === msg.channel.id)
            ? current.map((channel) => (channel.id === msg.channel.id ? msg.channel : channel))
            : [...current, msg.channel];
          const sorted = next.sort((a, b) => a.position - b.position);
          ensureValidActiveChannel(sorted);
          return sorted;
        });
        return;
      }

      if (msg.type === "channel_deleted") {
        if (joinedVoiceChannelId() === msg.id) {
          setJoinedVoiceChannel(null);
          setVoiceActionState("idle");
          cleanupMediaTransports();
          resetVoiceMediaState();
        }

        removeVoiceChannelState(msg.id);
        setChannels((current) => {
          const next = current.filter((channel) => channel.id !== msg.id);
          ensureValidActiveChannel(next);
          return next;
        });
        removeUnreadChannel(msg.id);
        return;
      }

      if (msg.type === "channel_activity") {
        if (msg.channel_id !== activeChannelId()) {
          incrementUnread(msg.channel_id);
          pulseBadge(msg.channel_id);
        }
        return;
      }

      if (msg.type === "voice_presence_snapshot") {
        applyVoiceSnapshot(msg.channels);
        return;
      }

      if (msg.type === "voice_user_joined") {
        applyVoiceJoined(msg.channel_id, msg.username);
        return;
      }

      if (msg.type === "voice_user_left") {
        applyVoiceLeft(msg.channel_id, msg.username);
        return;
      }

      if (msg.type === "voice_user_speaking") {
        applyVoiceSpeaking(msg.channel_id, msg.username, msg.speaking);
        return;
      }

      if (msg.type === "voice_joined") {
        setJoinedVoiceChannel(msg.channel_id);
        startCameraStateSubscription();
        startScreenStateSubscription();
        startVideoTilesSubscription();
        clearVoiceRejoinNotice();
        setVoiceActionState("idle");
        void initializeMediaTransports(msg.channel_id).catch((error) => {
          showErrorToast(errorMessage(error, "Failed to initialize media transports"));
        });
        setMicrophoneMuted(micMuted());
        setSpeakersMuted(speakerMuted());
        return;
      }

      if (msg.type === "voice_left") {
        if (joinedVoiceChannelId() === msg.channel_id) {
          setJoinedVoiceChannel(null);
          cleanupMediaTransports();
          resetVoiceMediaState();
        }
        setVoiceActionState("idle");
        return;
      }

      if (msg.type === "error" && voiceActionState() !== "idle") {
        setVoiceActionState("idle");
        showErrorToast(msg.message);
      }
    });

    const unsubscribeClose = onClose(() => {
      if (!joinedVoiceChannelId()) {
        return;
      }

      cleanupMediaTransports();
      setJoinedVoiceChannel(null);
      resetVoiceMediaState();
      setVoiceActionState("idle");
      showVoiceRejoinNotice();
    });

    onCleanup(() => {
      pulseTimers.forEach((timer) => clearTimeout(timer));
      pulseTimers.clear();
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
      unsubscribeClose();
      stopConnectionStatusSubscription();
      stopScreenSharePreview();
    });
  });

  function connectionStatusLabel() {
    const status = voiceConnectionStatus();
    if (status === "connected") {
      return "Connection: Connected";
    }

    if (status === "connecting") {
      return "Connection: Connecting...";
    }

    if (status === "reconnecting") {
      return "Connection: Reconnecting...";
    }

    if (status === "failed") {
      return "Connection: Failed";
    }

    return "Connection: Disconnected";
  }

  function effectiveScreenShareBitrateLabel() {
    const kbps = selectedScreenShareBitrateKbps();
    const mbps = kbps / 1000;
    if (mbps >= 10) {
      return `${mbps.toFixed(0)} Mbps`;
    }

    return `${mbps.toFixed(1)} Mbps`;
  }

  function formatNativeSenderRate(value: number) {
    if (value < 1000) {
      return `${value} B`;
    }
    if (value < 1000 * 1000) {
      return `${(value / 1000).toFixed(1)} KB`;
    }
    return `${(value / (1000 * 1000)).toFixed(2)} MB`;
  }

  function handleScreenShareSourceKindInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "screen" || value === "window" || value === "application") {
      savePreferredScreenShareSourceKind(value);
    }
  }

  function handleNativeCaptureSourceInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!value) {
      return;
    }

    setSelectedNativeSourceId(value);
    const selected = nativeSources().find((source) => source.id === value);
    if (selected) {
      savePreferredScreenShareSourceKind(
        selected.kind === "screen" ? "screen" : selected.kind === "application" ? "application" : "window",
      );
    }
  }

  function handleScreenShareResolutionInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "720p" || value === "1080p" || value === "1440p" || value === "4k") {
      savePreferredScreenShareResolution(value);
    }
  }

  function handleScreenShareFpsInput(event: Event) {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    if (value === 30 || value === 60) {
      savePreferredScreenShareFps(value as ScreenShareFps);
    }
  }

  function handleScreenShareBitrateModeInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "auto" || value === "balanced" || value === "high" || value === "ultra" || value === "custom") {
      savePreferredScreenShareBitrateMode(value as ScreenShareBitrateMode);
    }
  }

  function handleScreenShareCustomBitrateInput(event: Event) {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (!Number.isFinite(value)) {
      return;
    }

    savePreferredScreenShareCustomBitrateKbps(value);
  }

  function handleScreenShareEncoderBackendInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "auto" || value === "openh264" || value === "nvenc") {
      savePreferredScreenShareEncoderBackend(value as ScreenShareEncoderBackend);
    }
  }

  function handleScreenShareCodecPreferenceInput(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "auto" || value === "av1" || value === "vp9" || value === "vp8" || value === "h264") {
      savePreferredScreenShareCodecPreference(value as ScreenShareCodecPreference);
    }
  }

  function handleScreenShareCodecStrictModeInput(event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    savePreferredScreenShareCodecStrictMode(checked);
  }

  const sortedChannels = () => [...channels()].sort((a, b) => a.position - b.position);
  const textChannels = () => sortedChannels().filter((channel) => channel.kind === "text");
  const voiceChannels = () => sortedChannels().filter((channel) => channel.kind === "voice");
  const connectedVoiceChannelName = () => {
    const connectedChannelId = joinedVoiceChannelId();
    if (!connectedChannelId) {
      return null;
    }

    const channel = sortedChannels().find((entry) => entry.id === connectedChannelId);
    return channel ? channel.name : "Unknown channel";
  };

  createEffect(() => {
    clearActiveChannelUnread();
  });

  createEffect(() => {
    if (!channelCreateOpenKind()) {
      return;
    }

    if (channelCreateNameInputRef) {
      channelCreateNameInputRef.focus();
      channelCreateNameInputRef.select();
    }
  });

  createEffect(() => {
    if (!joinedVoiceChannelId()) {
      closeScreenShareModal();
    }
  });

  createEffect(() => {
    if (!screenShareModalOpen()) {
      stopScreenSharePreview();
    }
  });

  createEffect(() => {
    const stream = screenSharePreviewStream();
    if (!screenSharePreviewVideoRef) {
      return;
    }

    if (!stream) {
      screenSharePreviewVideoRef.srcObject = null;
      return;
    }

    screenSharePreviewVideoRef.srcObject = stream;
    screenSharePreviewVideoRef.muted = true;
    screenSharePreviewVideoRef.playsInline = true;
    void screenSharePreviewVideoRef.play().catch(() => undefined);
  });

  createEffect(() => {
    selectedNativeSourceId();
    preferredScreenShareSourceKind();
    untrack(() => stopScreenSharePreview());
  });

  createEffect(() => {
    if (!tauriRuntime || !screenShareEnabled()) {
      setNativeSenderMetrics(null);
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const status = await nativeCaptureStatus();
        if (!cancelled) {
          setNativeSenderMetrics(status.native_sender);
        }
      } catch {
        if (!cancelled) {
          setNativeSenderMetrics(null);
        }
      }
    };

    void pollStatus();
    const timer = window.setInterval(() => {
      void pollStatus();
    }, 1000);

    onCleanup(() => {
      cancelled = true;
      window.clearInterval(timer);
    });
  });

  return (
    <div class="channel-list">
      <h3>Channels</h3>
      <AsyncContent
        loading={isLoading()}
        loadingText="Loading channels..."
        error={sortedChannels().length === 0 ? loadError() : null}
        empty={false}
      >
        <div class="channel-groups">
          <section class="channel-group" aria-labelledby="text-channels-heading">
            <div class="channel-group-header">
              <h4 id="text-channels-heading" class="channel-group-heading">Text Channels</h4>
              <button
                type="button"
                class="channel-group-add"
                onClick={() => openCreateChannel("text")}
                disabled={isSaving()}
                title="Create text channel"
                aria-label="Create text channel"
              >
                <svg viewBox="0 0 16 16" class="channel-group-add-icon" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <Show when={textChannels().length > 0} fallback={<p class="channel-group-empty">No text channels yet</p>}>
              <ul class="channel-items">
                <For each={textChannels()}>
                  {(channel) => (
                    <ChannelRow
                      channel={channel}
                      prefix="#"
                      isActive={activeChannelId() === channel.id}
                      isVoiceConnected={joinedVoiceChannelId() === channel.id}
                      onSelect={() => selectChannel(channel)}
                      onDelete={() => void handleDeleteChannel(channel)}
                      disabled={isSaving()}
                      badge={
                        <Show when={unreadCount(channel.id) > 0}>
                          <span class={`channel-badge${pulsingByChannel()[channel.id] ? " is-pulsing" : ""}`}>
                            {formatUnreadBadge(channel.id)}
                          </span>
                        </Show>
                      }
                    />
                  )}
                </For>
              </ul>
            </Show>
          </section>

          <section class="channel-group" aria-labelledby="voice-channels-heading">
            <div class="channel-group-header">
              <h4 id="voice-channels-heading" class="channel-group-heading">Voice Channels</h4>
              <button
                type="button"
                class="channel-group-add"
                onClick={() => openCreateChannel("voice")}
                disabled={isSaving()}
                title="Create voice channel"
                aria-label="Create voice channel"
              >
                <svg viewBox="0 0 16 16" class="channel-group-add-icon" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <Show when={voiceChannels().length > 0} fallback={<p class="channel-group-empty">No voice channels yet</p>}>
              <ul class="channel-items">
                <For each={voiceChannels()}>
                  {(channel) => (
                    <ChannelRow
                      channel={channel}
                      prefix="~"
                      isActive={activeChannelId() === channel.id}
                      isVoiceConnected={joinedVoiceChannelId() === channel.id}
                      onSelect={() => selectChannel(channel)}
                      onDelete={() => void handleDeleteChannel(channel)}
                      disabled={isSaving()}
                    >
                      <Show when={voiceMembers(channel.id).length > 0}>
                        <ul class="channel-voice-members">
                          <For each={voiceMembers(channel.id)}>
                            {(username) => (
                              <li class="channel-voice-member">
                                <span
                                  class={`channel-voice-member-dot${isVoiceMemberSpeaking(channel.id, username) ? " is-speaking" : ""}`}
                                  aria-hidden="true"
                                />
                                <span>{username}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </ChannelRow>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </div>

        <Modal
          open={!!channelCreateOpenKind()}
          onClose={closeCreateChannel}
          title="Create Channel"
          ariaLabel="Create channel"
          backdropClass="channel-create-modal-backdrop"
          modalClass="channel-create-modal"
        >
          <form
            class="settings-section channel-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              const kind = channelCreateOpenKind();
              if (!kind) {
                return;
              }
              void handleCreateChannel(kind, channelCreateName(), channelCreateDescription());
            }}
          >
            <label class="settings-label" for="channel-create-kind">Channel type</label>
            <input
              id="channel-create-kind"
              type="text"
              value={channelCreateOpenKind() === "voice" ? "Voice" : "Text"}
              disabled
            />

            <label class="settings-label" for="channel-create-name">Channel name</label>
            <input
              id="channel-create-name"
              ref={channelCreateNameInputRef}
              type="text"
              value={channelCreateName()}
              onInput={(event) => setChannelCreateName(event.currentTarget.value)}
              placeholder={channelCreateOpenKind() === "voice" ? "new-voice-channel" : "new-text-channel"}
              maxlength={100}
              disabled={isSaving()}
            />

            <label class="settings-label" for="channel-create-description">Description</label>
            <input
              id="channel-create-description"
              type="text"
              value={channelCreateDescription()}
              onInput={(event) => setChannelCreateDescription(event.currentTarget.value)}
              placeholder="Optional channel description"
              maxlength={280}
              disabled={isSaving()}
            />
            <p class="settings-help">Optional description shown in channel metadata surfaces.</p>

            <div class="settings-actions">
              <button
                type="button"
                class="settings-secondary"
                onClick={closeCreateChannel}
                disabled={isSaving()}
              >
                Cancel
              </button>
              <button type="submit" disabled={isSaving()}>
                {isSaving() ? "Creating..." : "Create channel"}
              </button>
            </div>
          </form>
        </Modal>

        <div class="channel-footer">
          <Show when={voiceRejoinNotice() && !joinedVoiceChannelId()}>
            <div class="channel-footer-banner" role="status" aria-live="polite">
              <span>Voice disconnected after profile update. Click a voice channel to rejoin.</span>
              <button
                type="button"
                class="channel-footer-banner-dismiss"
                onClick={clearVoiceRejoinNotice}
                aria-label="Dismiss voice rejoin notice"
              >
                Dismiss
              </button>
            </div>
          </Show>
          <Show when={joinedVoiceChannelId()}>
            <div class="voice-dock">
              <div class="voice-dock-actions">
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-disconnect"
                  onClick={leaveVoiceChannel}
                  disabled={voiceActionState() !== "idle"}
                  title={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
                  aria-label={voiceActionState() === "leaving" ? "Disconnecting..." : "Disconnect"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z" fill="currentColor" />
                    <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-toggle"
                  onClick={handleToggleMicMuted}
                  title={micMuted() ? "Unmute microphone" : "Mute microphone"}
                  aria-label={micMuted() ? "Unmute microphone" : "Mute microphone"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" fill="currentColor" />
                    <path d="M18 11v1a6 6 0 0 1-12 0v-1H4v1a8 8 0 0 0 7 7.94V23h2v-3.06A8 8 0 0 0 20 12v-1z" fill="currentColor" />
                    <Show when={micMuted()}>
                      <path d="M4 4 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
                <button
                  type="button"
                  class="voice-dock-icon voice-dock-toggle"
                  onClick={handleToggleSpeakerMuted}
                  title={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
                  aria-label={speakerMuted() ? "Unmute speakers" : "Mute speakers"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M5 10v4h4l5 4V6l-5 4z" fill="currentColor" />
                    <Show when={!speakerMuted()}>
                      <path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                    <Show when={speakerMuted()}>
                      <path d="M16 8 21 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                      <path d="M21 8 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
                <button
                  type="button"
                  class={`voice-dock-icon voice-dock-toggle voice-dock-camera${cameraEnabled() ? " is-active" : ""}`}
                  onClick={() => void handleToggleCamera()}
                  disabled={cameraActionPending() || voiceActionState() !== "idle"}
                  title={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
                  aria-label={cameraEnabled() ? "Turn camera off" : "Turn camera on"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5v2.1l3.86-2.18A1 1 0 0 1 21.4 8.3v7.4a1 1 0 0 1-1.54.87L16 14.4v2.1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5z" fill="currentColor" />
                    <Show when={cameraEnabled()}>
                      <path d="M5 5 19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
                    </Show>
                  </svg>
                </button>
                <button
                  type="button"
                  class={`voice-dock-icon voice-dock-toggle voice-dock-screen${screenShareEnabled() ? " is-active" : ""}`}
                  onClick={() => void handleToggleScreenShare()}
                  disabled={screenActionPending() || voiceActionState() !== "idle"}
                  title={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
                  aria-label={screenShareEnabled() ? "Stop screen share" : "Start screen share"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M3.5 5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5v10A1.5 1.5 0 0 1 19 16.5H5A1.5 1.5 0 0 1 3.5 15z" fill="currentColor" />
                    <path d="M8.5 20h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
                    <path d="M12 16.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
                  </svg>
                </button>
              </div>
              <p class="voice-dock-channel">Connected: {connectedVoiceChannelName()}</p>
              <p class={`voice-dock-channel${voiceConnectionStatus() === "failed" ? " voice-dock-channel-alert" : ""}`}>
                {connectionStatusLabel()}
              </p>
              <Show when={voiceConnectionStatus() === "failed"}>
                <button type="button" class="settings-secondary" onClick={() => connect()}>
                  Retry connection
                </button>
              </Show>
              <Show when={cameraError()}>
                <p class="voice-dock-error">{cameraError()}</p>
              </Show>
              <Show when={screenShareEnabled() && screenShareRoutingMode()}>
                <p class="voice-dock-channel">Screen sharing via {screenShareRoutingMode()?.toUpperCase()}</p>
              </Show>
              <Show when={screenShareEnabled() && nativeDebugEnabled && nativeSenderMetrics()?.worker_active}>
                <div class="voice-dock-native-debug" role="status" aria-live="polite">
                  <p class="voice-dock-native-debug-title">Native Sender</p>
                  <p class="voice-dock-channel">Frames: {nativeSenderMetrics()?.received_packets ?? 0} dequeued / {nativeSenderMetrics()?.encoded_frames ?? 0} encoded</p>
                  <p class="voice-dock-channel">Output: {formatNativeSenderRate(nativeSenderMetrics()?.encoded_bytes ?? 0)} | RTP: {nativeSenderMetrics()?.rtp_packets_sent ?? 0} packets</p>
                  <p class="voice-dock-channel">Queue backlog: {nativeSenderMetrics()?.estimated_queue_depth ?? 0} | Drop(full): {nativeSenderMetrics()?.dropped_full ?? 0} | Drop(pre-encode): {nativeSenderMetrics()?.dropped_before_encode ?? 0}</p>
                  <p class="voice-dock-channel">Latency: {nativeSenderMetrics()?.last_encode_latency_ms ?? 0} ms | Encode errors: {nativeSenderMetrics()?.encode_errors ?? 0} | RTP errors: {nativeSenderMetrics()?.rtp_send_errors ?? 0} | Drop(send): {nativeSenderMetrics()?.dropped_during_send ?? 0}</p>
                  <p class="voice-dock-channel">Keyframe requests: {nativeSenderMetrics()?.keyframe_requests ?? 0} | Drop(no BGRA): {nativeSenderMetrics()?.dropped_missing_bgra ?? 0}</p>
                  <p class="voice-dock-channel">Transport: {nativeSenderMetrics()?.transport_connected ? "connected" : "disconnected"} | Producer: {nativeSenderMetrics()?.producer_connected ? "connected" : "disconnected"}</p>
                  <p class="voice-dock-channel">Degradation: {nativeSenderMetrics()?.degradation_level ?? "none"} | Fallback: {nativeSenderMetrics()?.recent_fallback_reason ?? "none"}</p>
                  <p class="voice-dock-channel">Pressure(avg/peak/max): {nativeSenderMetrics()?.pressure_window_avg_depth ?? 0}/{nativeSenderMetrics()?.pressure_window_peak_depth ?? 0}/{nativeSenderMetrics()?.pressure_window_max_peak_depth ?? 0}</p>
                  <p class="voice-dock-channel">Encoder backend: {nativeSenderMetrics()?.encoder_backend ?? "unknown"}</p>
                  <p class="voice-dock-channel">Encoder requested: {nativeSenderMetrics()?.encoder_backend_requested ?? "unknown"} | Backend fallback: {nativeSenderMetrics()?.encoder_backend_fallback_reason ?? "none"}</p>
                  <p class="voice-dock-channel">Backend runtime fallback events: {nativeSenderMetrics()?.encoder_backend_runtime_fallback_events ?? 0}</p>
                  <Show when={nativeSenderMetrics()?.rtp_target}>
                    <p class="voice-dock-channel">RTP target: {nativeSenderMetrics()?.rtp_target}</p>
                  </Show>
                </div>
              </Show>
              <Show when={screenShareError()}>
                <p class="voice-dock-error">{screenShareError()}</p>
              </Show>
            </div>
          </Show>
          <Modal
            open={tauriRuntime && screenShareModalOpen() && !screenShareEnabled()}
            onClose={closeScreenShareModal}
            title="Share Screen"
            ariaLabel="Share screen"
            backdropClass="voice-share-modal-backdrop"
            modalClass="voice-share-modal"
          >
                <section class="settings-section">
                  <h5>Capture Source</h5>
                  <Show when={!nativeSourcesLoading()} fallback={<p class="settings-help">Loading native sources...</p>}>
                    <Show when={nativeSources().length > 0} fallback={(
                      <>
                        <label class="settings-label" for="voice-share-source-kind">Source preference</label>
                        <select
                          id="voice-share-source-kind"
                          value={preferredScreenShareSourceKind()}
                          onInput={handleScreenShareSourceKindInput}
                        >
                          <option value="screen">Entire screen</option>
                          <option value="window">Window</option>
                          <option value="application">Application</option>
                        </select>
                      </>
                    )}>
                      <label class="settings-label" for="voice-share-native-source">Native source</label>
                      <select
                        id="voice-share-native-source"
                        value={selectedNativeSourceId() ?? ""}
                        onInput={handleNativeCaptureSourceInput}
                      >
                        <For each={nativeSources()}>
                          {(source) => (
                            <option value={source.id}>{nativeSourceLabel(source)}</option>
                          )}
                        </For>
                      </select>
                    </Show>
                  </Show>

                  <Show when={nativeSourcesError()}>
                    <p class="voice-dock-error">{nativeSourcesError()}</p>
                  </Show>

                  <div class="settings-actions">
                    <button
                      type="button"
                      class="settings-secondary"
                      onClick={() => void Promise.all([loadNativeCaptureSources(), loadNativeCodecSupport()])}
                    >
                      Refresh sources
                    </button>
                  </div>

                  <p class="settings-help">
                    Source selection is native in Tauri. Confirm the same source in the OS share prompt if shown.
                  </p>

                  <label class="settings-label" for="voice-share-preview-video">Preview</label>
                  <div class="voice-share-preview" role="status" aria-live="polite">
                    <Show
                      when={screenSharePreviewStream()}
                      fallback={<p class="settings-help">Preview is off. Use Preview source to verify what will be shared.</p>}
                    >
                      <video
                        id="voice-share-preview-video"
                        ref={screenSharePreviewVideoRef}
                        class="voice-share-preview-video"
                        autoplay
                        muted
                        playsinline
                      />
                    </Show>
                  </div>

                  <Show when={screenSharePreviewError()}>
                    <p class="voice-dock-error">{screenSharePreviewError()}</p>
                  </Show>

                  <h5>Quality</h5>
                  <label class="settings-label" for="voice-share-resolution">Resolution</label>
                  <select
                    id="voice-share-resolution"
                    value={preferredScreenShareResolution()}
                    onInput={handleScreenShareResolutionInput}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="1440p">1440p</option>
                    <option value="4k">4k</option>
                  </select>

                  <label class="settings-label" for="voice-share-fps">FPS</label>
                  <select
                    id="voice-share-fps"
                    value={String(preferredScreenShareFps())}
                    onInput={handleScreenShareFpsInput}
                  >
                    <option value="30">30 FPS</option>
                    <option value="60">60 FPS</option>
                  </select>

                  <label class="settings-label" for="voice-share-bitrate">Bitrate</label>
                  <select
                    id="voice-share-bitrate"
                    value={preferredScreenShareBitrateMode()}
                    onInput={handleScreenShareBitrateModeInput}
                  >
                    <option value="auto">Auto</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High</option>
                    <option value="ultra">Ultra</option>
                    <option value="custom">Custom</option>
                  </select>

                  <Show when={preferredScreenShareBitrateMode() === "custom"}>
                    <label class="settings-label" for="voice-share-custom-bitrate">Custom bitrate (kbps)</label>
                    <input
                      id="voice-share-custom-bitrate"
                      type="number"
                      min="1500"
                      max="50000"
                      step="100"
                      value={String(preferredScreenShareCustomBitrateKbps())}
                      onInput={handleScreenShareCustomBitrateInput}
                    />
                  </Show>

                  <label class="settings-label" for="voice-share-encoder-backend">Encoder backend</label>
                  <select
                    id="voice-share-encoder-backend"
                    value={preferredScreenShareEncoderBackend()}
                    onInput={handleScreenShareEncoderBackendInput}
                  >
                    <option value="auto">Auto (prefer NVENC)</option>
                    <option value="nvenc">NVENC only</option>
                    <option value="openh264">OpenH264 only</option>
                  </select>

                  <label class="settings-label" for="voice-share-codec">Codec</label>
                  <select
                    id="voice-share-codec"
                    value={preferredScreenShareCodecPreference()}
                    onInput={handleScreenShareCodecPreferenceInput}
                  >
                    <option value="auto">Auto</option>
                    <option
                      value="av1"
                      disabled={codecPreferenceDisabled("av1")}
                      title={codecPreferenceUnavailableReason("av1")}
                    >
                      AV1
                    </option>
                    <option
                      value="vp9"
                      disabled={codecPreferenceDisabled("vp9")}
                      title={codecPreferenceUnavailableReason("vp9")}
                    >
                      VP9
                    </option>
                    <option
                      value="vp8"
                      disabled={codecPreferenceDisabled("vp8")}
                      title={codecPreferenceUnavailableReason("vp8")}
                    >
                      VP8
                    </option>
                    <option
                      value="h264"
                      disabled={codecPreferenceDisabled("h264")}
                      title={codecPreferenceUnavailableReason("h264")}
                    >
                      H264
                    </option>
                  </select>

                  <Show when={!supportsSelectedCodecPreference()}>
                    <p class="voice-dock-error">Selected codec is unavailable on this client. Pick a different codec or Auto.</p>
                  </Show>

                  <label class="settings-checkbox" for="voice-share-codec-strict-mode">
                    <input
                      id="voice-share-codec-strict-mode"
                      type="checkbox"
                      checked={preferredScreenShareCodecStrictMode()}
                      onInput={handleScreenShareCodecStrictModeInput}
                    />
                    Strict codec mode (no codec fallback)
                  </label>
                  <p class="settings-help">When enabled, manual codec selection fails if the requested codec cannot be negotiated.</p>

                  <p class="settings-help">Estimated target bitrate: {effectiveScreenShareBitrateLabel()}</p>

                  <div class="settings-actions">
                    <button
                      type="button"
                      class="settings-secondary"
                      onClick={() => void startScreenSharePreview()}
                    >
                      Preview source
                    </button>
                    <button
                      type="button"
                      class="settings-secondary"
                      onClick={stopScreenSharePreview}
                      disabled={!screenSharePreviewStream()}
                    >
                      Stop preview
                    </button>
                    <button
                      type="button"
                      class="settings-secondary"
                      onClick={closeScreenShareModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConfirmTauriScreenShare()}
                      disabled={screenActionPending() || voiceActionState() !== "idle" || !supportsSelectedCodecPreference()}
                    >
                      {screenActionPending() ? "Starting..." : "Start sharing"}
                    </button>
                  </div>
                </section>
          </Modal>
          <UserSettingsDock />
        </div>
      </AsyncContent>
      <Show when={toastError()}>
        <div class="toast toast-error" role="status" aria-live="polite">{toastError()}</div>
      </Show>
    </div>
  );
}
