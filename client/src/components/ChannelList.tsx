import {
    createMemo,
    For,
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    untrack,
} from "solid-js";
import { username as currentUsername } from "../stores/auth";
import { del, get, patch as patchRequest, post } from "../api/http";
import { listDmThreads } from "../api/dms";
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
    nativeCaptureStatus,
    type NativeCaptureStatus,
    type NativeCaptureSource,
} from "../api/nativeCapture";
import { connect, onClose, onMessage, send } from "../api/ws";
import {
    activeChannelId,
    activeDmThreadId,
    Channel,
    clearUnread,
    incrementUnread,
    removeUnreadChannel,
    setActiveDmThread,
    setActiveTextChannel,
    unreadCount,
} from "../stores/chat";
import {
    preferredScreenShareBitrateMode,
    preferredScreenShareCustomBitrateKbps,
    preferredScreenShareFps,
    preferredScreenShareResolution,
    preferredScreenShareSourceKind,
    savePreferredScreenShareSourceKind,
    closeSettings,
    settingsOpen,
} from "../stores/settings";
import { errorMessage } from "../utils/error";
import { isTauriRuntime } from "../utils/platform";
import {
    playVoiceJoinCue,
    playVoiceLeaveCue,
    preloadVoiceCues,
} from "../utils/voiceCue";
import {
    playMessageNotificationCue,
    preloadMessageNotificationCue,
} from "../utils/messageCue";
import {
    applyVoiceJoined,
    applyVoiceLeft,
    applyVoiceSpeaking,
    applyVoiceSnapshot,
    clearVoiceRejoinNotice,
    clearVoiceCameraError,
    cameraEnabled,
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
    showVoiceRejoinNotice,
    toggleMicMuted,
    toggleSpeakerMuted,
    voiceRejoinNotice,
    voiceActionState,
    videoTiles,
    watchedStreamProducerId,
    startWatchingStream,
} from "../stores/voice";
import AsyncContent from "./AsyncContent";
import UserSettingsDock from "./UserSettingsDock";
import { PlusIcon } from "./icons";
import {
    ChannelRow,
    CreateChannelModal,
    EditChannelModal,
    ScreenShareModal,
    VoiceDock,
    autoBitrateKbps,
    manualBitrateKbps,
    previewResolutionConstraints,
} from "./channel-list";
import {
    handleLongPressEnd,
    handleLongPressStart,
    openContextMenu,
    registerContextMenuHandlers,
    setContextMenuTarget,
} from "../stores/contextMenu";
import UserAvatar from "./UserAvatar";
import { displayNameFor, profileFor, upsertUserProfile } from "../stores/userProfiles";
import {
    dmThreads,
    setDmThreads,
    setDmUnreadCount,
    updateDmThreadActivity,
    upsertDmThread,
} from "../stores/dms";

async function fetchChannels() {
    return get<Channel[]>("/channels");
}

export default function ChannelList() {
    const [channels, setChannels] = createSignal<Channel[]>([]);
    const [isLoading, setIsLoading] = createSignal(true);
    const [isSaving, setIsSaving] = createSignal(false);
    const [channelCreateOpenKind, setChannelCreateOpenKind] = createSignal<
        Channel["kind"] | null
    >(null);
    const [channelCreateName, setChannelCreateName] = createSignal("");
    const [channelCreateDescription, setChannelCreateDescription] =
        createSignal("");
    const [channelCreateOpusBitrate, setChannelCreateOpusBitrate] = createSignal<
        number | undefined
    >(undefined);
    const [channelCreateOpusDtx, setChannelCreateOpusDtx] = createSignal(false);
    const [channelCreateOpusFec, setChannelCreateOpusFec] = createSignal(false);
    const [channelEditOpen, setChannelEditOpen] = createSignal<Channel | null>(
        null,
    );
    const [channelEditName, setChannelEditName] = createSignal("");
    const [channelEditDescription, setChannelEditDescription] = createSignal("");
    const [channelEditOpusBitrate, setChannelEditOpusBitrate] = createSignal<
        number | undefined
    >(undefined);
    const [loadError, setLoadError] = createSignal("");
    const [toastError, setToastError] = createSignal("");
    const [cameraActionPending, setCameraActionPending] = createSignal(false);
    const [screenActionPending, setScreenActionPending] = createSignal(false);
    const [screenShareModalOpen, setScreenShareModalOpen] = createSignal(false);
    const [nativeSourcesLoading, setNativeSourcesLoading] = createSignal(false);
    const [nativeSourcesError, setNativeSourcesError] = createSignal("");
    const [nativeSources, setNativeSources] = createSignal<
        NativeCaptureSource[]
    >([]);
    const [selectedNativeSourceId, setSelectedNativeSourceId] = createSignal<
        string | null
    >(null);
    const [screenSharePreviewStream, setScreenSharePreviewStream] =
        createSignal<MediaStream | null>(null);
    const [screenSharePreviewError, setScreenSharePreviewError] =
        createSignal("");
    const [nativeSenderMetrics, setNativeSenderMetrics] = createSignal<
        NativeCaptureStatus["native_sender"] | null
    >(null);
    const [pulsingByChannel, setPulsingByChannel] = createSignal<
        Record<string, boolean>
    >({});
    const [memberHoverPopoverKey, setMemberHoverPopoverKey] = createSignal<
        string | null
    >(null);
    const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const tauriRuntime = isTauriRuntime();
    const nativeDebugEnabled =
        tauriRuntime &&
        (import.meta.env.DEV ||
            window.localStorage.getItem("yankcord_debug_native_sender") ===
                "1");
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    let screenSharePreviewVideoRef: HTMLVideoElement | undefined;
    let channelCreateNameInputRef: HTMLInputElement | undefined;

    function selectedScreenShareSourceKind():
        | "screen"
        | "window"
        | "application" {
        const selected =
            nativeSources().find(
                (source) => source.id === selectedNativeSourceId(),
            ) ?? null;
        if (selected) {
            return selected.kind === "screen"
                ? "screen"
                : selected.kind === "application"
                  ? "application"
                  : "window";
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

    async function startScreenSharePreview() {
        setScreenSharePreviewError("");
        stopScreenSharePreview();

        const sourceKind = selectedScreenShareSourceKind();
        const displaySurface = sourceKind === "screen" ? "monitor" : "window";

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    ...previewResolutionConstraints(
                        preferredScreenShareResolution(),
                    ),
                    frameRate: {
                        ideal: preferredScreenShareFps(),
                        max: preferredScreenShareFps(),
                    },
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
            setScreenSharePreviewError(
                errorMessage(error, "Failed to start preview"),
            );
        }
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
        const selected =
            nativeSources().find(
                (source) => source.id === selectedNativeSourceId(),
            ) ?? null;
        const sourceKind = selected
            ? selected.kind === "screen"
                ? "screen"
                : selected.kind === "application"
                  ? "application"
                  : "window"
            : preferredScreenShareSourceKind();

        return {
            resolution: preferredScreenShareResolution(),
            fps: preferredScreenShareFps(),
            bitrateKbps: selectedScreenShareBitrateKbps(),
            sourceKind,
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
            if (
                selectedId &&
                sources.some((source) => source.id === selectedId)
            ) {
                return;
            }

            const preferredKind = preferredScreenShareSourceKind();
            const preferredSource = sources.find(
                (source) => source.kind === preferredKind,
            );
            setSelectedNativeSourceId(
                preferredSource?.id ?? sources[0]?.id ?? null,
            );
        } catch (error) {
            setNativeSources([]);
            setSelectedNativeSourceId(null);
            setNativeSourcesError(
                errorMessage(error, "Failed to load native capture sources"),
            );
        } finally {
            setNativeSourcesLoading(false);
        }
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
        if (activeDmThreadId()) {
            return;
        }

        const selected = activeChannelId();
        const selectedStillExists = selected
            ? nextChannels.some((channel) => channel.id === selected)
            : false;

        if (selectedStillExists) {
            return;
        }

        setActiveTextChannel(nextChannels[0]?.id ?? null);
    }

    function joinVoiceChannel(channelId: string) {
        if (
            voiceActionState() !== "idle" ||
            joinedVoiceChannelId() === channelId
        ) {
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

    async function startScreenShareWithOptions(
        channelId: string,
        options?: ScreenShareStartOptions,
    ) {
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

        const selected =
            nativeSources().find(
                (source) => source.id === selectedNativeSourceId(),
            ) ?? null;
        if (selected) {
            savePreferredScreenShareSourceKind(
                selected.kind === "screen"
                    ? "screen"
                    : selected.kind === "application"
                      ? "application"
                      : "window",
            );
        }

        const result = await startScreenShareWithOptions(
            channelId,
            buildScreenShareOptions(),
        );
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

        if (settingsOpen()) {
            closeSettings();
        }

        setActiveTextChannel(channel.id);
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

    function formatDmUnreadBadge(count: number) {
        if (count <= 0) {
            return "";
        }

        return count > 99 ? "99+" : String(count);
    }

    function selectDmThread(threadId: string) {
        if (settingsOpen()) {
            closeSettings();
        }

        setActiveDmThread(threadId);
        setDmUnreadCount(threadId, 0);
    }

    function voiceMembers(channelId: string) {
        return participantsByChannel()[channelId] ?? [];
    }

    const liveScreenTilesByUsername = createMemo(() => {
        const next = new Map<string, { producerId: string }>();
        for (const tile of videoTiles()) {
            if (tile.source !== "screen") {
                continue;
            }

            next.set(tile.username, { producerId: tile.producerId });
        }

        return next;
    });

    function streamTileForVoiceMember(channelId: string, memberUsername: string) {
        if (channelId !== joinedVoiceChannelId()) {
            return null;
        }

        return liveScreenTilesByUsername().get(memberUsername) ?? null;
    }

    function voiceMemberPopoverKey(channelId: string, memberUsername: string) {
        return `${channelId}:${memberUsername}`;
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

    async function loadInitialDms() {
        try {
            const threads = await listDmThreads();
            setDmThreads(threads);
        } catch {
            // no-op: DM list can recover from websocket updates
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
        setChannelCreateOpusBitrate(undefined);
        setChannelCreateOpusDtx(false);
        setChannelCreateOpusFec(false);
    }

    function openEditChannel(channel: Channel) {
        if (isSaving()) {
            return;
        }

        setChannelEditOpen(channel);
        setChannelEditName(channel.name);
        setChannelEditDescription(channel.description ?? "");
        setChannelEditOpusBitrate(channel.opus_bitrate ?? undefined);
    }

    function closeEditChannel() {
        setChannelEditOpen(null);
        setChannelEditName("");
        setChannelEditDescription("");
        setChannelEditOpusBitrate(undefined);
    }

    async function handleCreateChannel(
        kind: Channel["kind"],
        rawName: string,
        rawDescription: string,
        opusBitrate?: number,
        opusDtx?: boolean,
        opusFec?: boolean,
    ) {
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
                description:
                    trimmedDescription.length > 0 ? trimmedDescription : null,
                kind,
                opus_bitrate: opusBitrate,
                opus_dtx: opusDtx,
                opus_fec: opusFec,
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

    async function handleUpdateChannel(
        channel: Channel,
        rawName: string,
        rawDescription: string,
        opusBitrate?: number,
    ) {
        if (isSaving()) {
            return;
        }

        const trimmedName = rawName.trim();
        const trimmedDescription = rawDescription.trim();

        if (!trimmedName) {
            showErrorToast("Channel name is required");
            return;
        }

        setIsSaving(true);
        try {
            await patchRequest<Channel>(`/channels/${channel.id}`, {
                name: trimmedName,
                description:
                    trimmedDescription.length > 0 ? trimmedDescription : null,
                opus_bitrate: channel.kind === "voice" ? opusBitrate : null,
            });
            closeEditChannel();
        } catch (error) {
            showErrorToast(errorMessage(error, "Failed to update channel"));
        } finally {
            setIsSaving(false);
        }
    }

    onMount(() => {
        preloadVoiceCues();
        preloadMessageNotificationCue();
        connect();
        startConnectionStatusSubscription();
        void loadInitialChannels();
        void loadInitialDms();

        registerContextMenuHandlers({
            channel: {
                onEdit: (channel) => openEditChannel(channel),
                onDelete: (channel) => void handleDeleteChannel(channel),
            },
        });

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
                    const next = current.some(
                        (channel) => channel.id === msg.channel.id,
                    )
                        ? current.map((channel) =>
                              channel.id === msg.channel.id
                                  ? msg.channel
                                  : channel,
                          )
                        : [...current, msg.channel];
                    const sorted = next.sort((a, b) => a.position - b.position);
                    ensureValidActiveChannel(sorted);
                    return sorted;
                });
                return;
            }

            if (msg.type === "channel_updated") {
                setChannels((current) => {
                    const next = current.map((channel) =>
                        channel.id === msg.channel.id ? msg.channel : channel,
                    );
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
                    const next = current.filter(
                        (channel) => channel.id !== msg.id,
                    );
                    ensureValidActiveChannel(next);
                    return next;
                });
                removeUnreadChannel(msg.id);
                return;
            }

            if (msg.type === "channel_activity") {
                const isCurrentChannel = msg.channel_id === activeChannelId();
                const isWindowFocused =
                    document.visibilityState === "visible" &&
                    document.hasFocus();

                if (!isCurrentChannel) {
                    incrementUnread(msg.channel_id);
                    pulseBadge(msg.channel_id);
                    playMessageNotificationCue();
                    return;
                }

                if (!isWindowFocused) {
                    playMessageNotificationCue();
                }
                return;
            }

            if (msg.type === "voice_presence_snapshot") {
                applyVoiceSnapshot(msg.channels);
                return;
            }

            if (msg.type === "voice_user_joined") {
                if (
                    joinedVoiceChannelId() === msg.channel_id &&
                    msg.username !== currentUsername()
                ) {
                    playVoiceJoinCue();
                }
                applyVoiceJoined(msg.channel_id, msg.username);
                return;
            }

            if (msg.type === "voice_user_left") {
                if (
                    joinedVoiceChannelId() === msg.channel_id &&
                    msg.username !== currentUsername()
                ) {
                    playVoiceLeaveCue();
                }
                applyVoiceLeft(msg.channel_id, msg.username);
                return;
            }

            if (msg.type === "voice_user_speaking") {
                applyVoiceSpeaking(msg.channel_id, msg.username, msg.speaking);
                return;
            }

            if (msg.type === "voice_joined") {
                playVoiceJoinCue();
                setJoinedVoiceChannel(msg.channel_id);
                startCameraStateSubscription();
                startScreenStateSubscription();
                startVideoTilesSubscription();
                clearVoiceRejoinNotice();
                setVoiceActionState("idle");
                void initializeMediaTransports(msg.channel_id).catch(
                    (error) => {
                        showErrorToast(
                            errorMessage(
                                error,
                                "Failed to initialize media transports",
                            ),
                        );
                    },
                );
                setMicrophoneMuted(micMuted());
                setSpeakersMuted(speakerMuted());
                return;
            }

            if (msg.type === "voice_left") {
                if (joinedVoiceChannelId() === msg.channel_id) {
                    playVoiceLeaveCue();
                    setJoinedVoiceChannel(null);
                    cleanupMediaTransports();
                    resetVoiceMediaState();
                }
                setVoiceActionState("idle");
                return;
            }

            if (msg.type === "dm_thread_created") {
                upsertDmThread({
                    thread_id: msg.thread_id,
                    other_username: msg.other_username,
                    other_display_name: msg.other_display_name,
                    other_avatar_url: msg.other_avatar_url,
                    last_message_id: msg.last_message_id,
                    last_message_preview: msg.last_message_preview,
                    last_message_at: msg.last_message_at,
                    unread_count: msg.unread_count,
                });
                return;
            }

            if (msg.type === "dm_thread_updated") {
                updateDmThreadActivity(
                    msg.thread_id,
                    msg.last_message_id,
                    msg.last_message_preview,
                    msg.last_message_at,
                );
                return;
            }

            if (msg.type === "dm_unread_updated") {
                if (msg.thread_id !== activeDmThreadId()) {
                    setDmUnreadCount(msg.thread_id, msg.unread_count);
                    if (msg.unread_count > 0) {
                        playMessageNotificationCue();
                    }
                } else {
                    setDmUnreadCount(msg.thread_id, 0);
                }
                return;
            }

            if (msg.type === "user_profile_updated") {
                upsertUserProfile({
                    username: msg.username,
                    display_name: msg.display_name,
                    avatar_url: msg.avatar_url,
                    profile_description: msg.profile_description,
                    profile_status: msg.profile_status,
                });
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
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
            unsubscribe();
            unsubscribeClose();
            stopConnectionStatusSubscription();
            stopScreenSharePreview();
        });
    });

    const sortedChannels = () =>
        [...channels()].sort((a, b) => a.position - b.position);
    const textChannels = () =>
        sortedChannels().filter((channel) => channel.kind === "text");
    const voiceChannels = () =>
        sortedChannels().filter((channel) => channel.kind === "voice");
    const connectedVoiceChannelName = () => {
        const connectedChannelId = joinedVoiceChannelId();
        if (!connectedChannelId) {
            return null;
        }

        const channel = sortedChannels().find(
            (entry) => entry.id === connectedChannelId,
        );
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
                    <section
                        class="channel-group"
                        aria-labelledby="text-channels-heading"
                    >
                        <div class="channel-group-header">
                            <h4
                                id="text-channels-heading"
                                class="channel-group-heading"
                            >
                                Text Channels
                            </h4>
                            <button
                                type="button"
                                class="channel-group-add"
                                onClick={() => openCreateChannel("text")}
                                disabled={isSaving()}
                                title="Create text channel"
                                aria-label="Create text channel"
                            >
                                <PlusIcon class="channel-group-add-icon" />
                            </button>
                        </div>
                        <Show
                            when={textChannels().length > 0}
                            fallback={
                                <p class="channel-group-empty">
                                    No text channels yet
                                </p>
                            }
                        >
                            <ul class="channel-items">
                                <For each={textChannels()}>
                                    {(channel) => (
                                        <ChannelRow
                                            channel={channel}
                                            prefix="#"
                                            isActive={
                                                activeChannelId() === channel.id
                                            }
                                            isVoiceConnected={
                                                joinedVoiceChannelId() ===
                                                channel.id
                                            }
                                            onSelect={() =>
                                                selectChannel(channel)
                                            }
                                            onDelete={() =>
                                                void handleDeleteChannel(channel)
                                            }
                                            disabled={isSaving()}
                                            badge={
                                                <Show
                                                    when={
                                                        unreadCount(
                                                            channel.id,
                                                        ) > 0
                                                    }
                                                >
                                                    <span
                                                        class={`channel-badge${pulsingByChannel()[channel.id] ? " is-pulsing" : ""}`}
                                                    >
                                                        {formatUnreadBadge(
                                                            channel.id,
                                                        )}
                                                    </span>
                                                </Show>
                                            }
                                        />
                                    )}
                                </For>
                            </ul>
                        </Show>
                    </section>

                    <section
                        class="channel-group"
                        aria-labelledby="dm-channels-heading"
                    >
                        <div class="channel-group-header">
                            <h4 id="dm-channels-heading" class="channel-group-heading">Direct Messages</h4>
                        </div>
                        <Show
                            when={dmThreads().length > 0}
                            fallback={
                                <p class="channel-group-empty">
                                    No direct messages yet
                                </p>
                            }
                        >
                            <ul class="channel-items">
                                <For each={dmThreads()}>
                                    {(thread) => (
                                        <li class="channel-row">
                                            <button
                                                type="button"
                                                class={`channel-item${activeDmThreadId() === thread.thread_id ? " is-active" : ""}`}
                                                onClick={() =>
                                                    selectDmThread(
                                                        thread.thread_id,
                                                    )
                                                }
                                            >
                                                <span class="channel-prefix">
                                                    @
                                                </span>
                                                <span class="channel-name">
                                                    {profileFor(thread.other_username)
                                                        ? displayNameFor(thread.other_username)
                                                        : thread.other_display_name}
                                                </span>
                                                <Show
                                                    when={thread.unread_count > 0}
                                                >
                                                    <span class="channel-badge">
                                                        {formatDmUnreadBadge(
                                                            thread.unread_count,
                                                        )}
                                                    </span>
                                                </Show>
                                            </button>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>
                    </section>

                    <section
                        class="channel-group"
                        aria-labelledby="voice-channels-heading"
                    >
                        <div class="channel-group-header">
                            <h4
                                id="voice-channels-heading"
                                class="channel-group-heading"
                            >
                                Voice Channels
                            </h4>
                            <button
                                type="button"
                                class="channel-group-add"
                                onClick={() => openCreateChannel("voice")}
                                disabled={isSaving()}
                                title="Create voice channel"
                                aria-label="Create voice channel"
                            >
                                <PlusIcon class="channel-group-add-icon" />
                            </button>
                        </div>
                        <Show
                            when={voiceChannels().length > 0}
                            fallback={
                                <p class="channel-group-empty">
                                    No voice channels yet
                                </p>
                            }
                        >
                            <ul class="channel-items">
                                <For each={voiceChannels()}>
                                    {(channel) => (
                                        <ChannelRow
                                            channel={channel}
                                            prefix="~"
                                            isActive={
                                                activeChannelId() === channel.id
                                            }
                                            isVoiceConnected={
                                                joinedVoiceChannelId() ===
                                                channel.id
                                            }
                                            onSelect={() =>
                                                selectChannel(channel)
                                            }
                                            onDelete={() =>
                                                void handleDeleteChannel(
                                                    channel,
                                                )
                                            }
                                            disabled={isSaving()}
                                        >
                                            <Show
                                                when={
                                                    voiceMembers(channel.id)
                                                        .length > 0
                                                }
                                            >
                                                <ul class="channel-voice-members">
                                                    <For
                                                        each={voiceMembers(
                                                            channel.id,
                                                        )}
                                                    >
                                                        {(memberUsername) => (
                                                            <li
                                                                class={`channel-voice-member${joinedVoiceChannelId() === channel.id ? " channel-voice-member-connected" : ""}`}
                                                                tabIndex={0}
                                                                onContextMenu={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    openContextMenu(event.clientX, event.clientY, "member", memberUsername, { username: memberUsername });
                                                                }}
                                                                onFocus={() => {
                                                                    setContextMenuTarget("member", memberUsername, { username: memberUsername });
                                                                    if (streamTileForVoiceMember(channel.id, memberUsername)) {
                                                                        setMemberHoverPopoverKey(
                                                                            voiceMemberPopoverKey(channel.id, memberUsername),
                                                                        );
                                                                    }
                                                                }}
                                                                onBlur={(event) => {
                                                                    const nextTarget = event.relatedTarget;
                                                                    if (
                                                                        nextTarget instanceof Node &&
                                                                        event.currentTarget.contains(nextTarget)
                                                                    ) {
                                                                        return;
                                                                    }

                                                                    if (
                                                                        memberHoverPopoverKey() ===
                                                                        voiceMemberPopoverKey(channel.id, memberUsername)
                                                                    ) {
                                                                        setMemberHoverPopoverKey(null);
                                                                    }
                                                                }}
                                                                onMouseEnter={() => {
                                                                    if (streamTileForVoiceMember(channel.id, memberUsername)) {
                                                                        setMemberHoverPopoverKey(
                                                                            voiceMemberPopoverKey(channel.id, memberUsername),
                                                                        );
                                                                    }
                                                                }}
                                                                onMouseLeave={() => {
                                                                    if (
                                                                        memberHoverPopoverKey() ===
                                                                        voiceMemberPopoverKey(channel.id, memberUsername)
                                                                    ) {
                                                                        setMemberHoverPopoverKey(null);
                                                                    }
                                                                }}
                                                                onKeyDown={(event) => {
                                                                    if (event.key !== "Enter" && event.key !== " ") {
                                                                        return;
                                                                    }

                                                                    const liveTile = streamTileForVoiceMember(channel.id, memberUsername);
                                                                    if (!liveTile) {
                                                                        return;
                                                                    }

                                                                    event.preventDefault();
                                                                    startWatchingStream(liveTile.producerId);
                                                                    setMemberHoverPopoverKey(null);
                                                                }}
                                                                onTouchStart={(event) => {
                                                                    const touch = event.touches[0];
                                                                    handleLongPressStart(touch.clientX, touch.clientY, "member", memberUsername, { username: memberUsername });
                                                                }}
                                                                onTouchEnd={handleLongPressEnd}
                                                                onTouchCancel={handleLongPressEnd}
                                                            >
                                                                <span
                                                                    class={`channel-voice-member-dot${isVoiceMemberSpeaking(channel.id, memberUsername) ? " is-speaking" : ""}`}
                                                                    aria-hidden="true"
                                                                />
                                                                <UserAvatar
                                                                    username={memberUsername}
                                                                    class="channel-voice-member-avatar"
                                                                    size={
                                                                        joinedVoiceChannelId() === channel.id
                                                                            ? 24
                                                                            : 18
                                                                    }
                                                                />
                                                                <span class="channel-voice-member-name">
                                                                    {displayNameFor(memberUsername)}
                                                                </span>
                                                                <Show
                                                                    when={streamTileForVoiceMember(channel.id, memberUsername)}
                                                                >
                                                                    {(liveTile) => (
                                                                        <>
                                                                            <span
                                                                                class="channel-voice-live-badge"
                                                                                aria-label={`${displayNameFor(memberUsername)} is streaming live`}
                                                                            >
                                                                                LIVE
                                                                            </span>
                                                                            <Show
                                                                                when={
                                                                                    memberHoverPopoverKey() ===
                                                                                    voiceMemberPopoverKey(channel.id, memberUsername)
                                                                                }
                                                                            >
                                                                                <div
                                                                                    class="channel-stream-hover-popover"
                                                                                    role="dialog"
                                                                                    aria-label={`Watch ${displayNameFor(memberUsername)} stream`}
                                                                                >
                                                                                    <p class="channel-stream-hover-title">
                                                                                        {displayNameFor(memberUsername)}
                                                                                    </p>
                                                                                    <p class="channel-stream-hover-text">
                                                                                        Live screen share
                                                                                    </p>
                                                                                    <button
                                                                                        type="button"
                                                                                        class="channel-stream-watch-button"
                                                                                        onClick={(event) => {
                                                                                            event.preventDefault();
                                                                                            event.stopPropagation();
                                                                                            startWatchingStream(liveTile().producerId);
                                                                                            setMemberHoverPopoverKey(null);
                                                                                        }}
                                                                                        disabled={
                                                                                            watchedStreamProducerId() ===
                                                                                            liveTile().producerId
                                                                                        }
                                                                                    >
                                                                                        {watchedStreamProducerId() ===
                                                                                        liveTile().producerId
                                                                                            ? "Watching"
                                                                                            : "Watch Stream"}
                                                                                    </button>
                                                                                </div>
                                                                            </Show>
                                                                        </>
                                                                    )}
                                                                </Show>
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

                <CreateChannelModal
                    openKind={channelCreateOpenKind()}
                    onClose={closeCreateChannel}
                    name={channelCreateName}
                    setName={setChannelCreateName}
                    description={channelCreateDescription}
                    setDescription={setChannelCreateDescription}
                    nameInputRef={() => channelCreateNameInputRef}
                    isSaving={isSaving()}
                    opusBitrate={channelCreateOpusBitrate}
                    setOpusBitrate={setChannelCreateOpusBitrate}
                    opusDtx={channelCreateOpusDtx}
                    setOpusDtx={setChannelCreateOpusDtx}
                    opusFec={channelCreateOpusFec}
                    setOpusFec={setChannelCreateOpusFec}
                    onSubmit={(kind, name, description, opusBitrate, opusDtx, opusFec) =>
                        void handleCreateChannel(kind, name, description, opusBitrate, opusDtx, opusFec)
                    }
                />

                <EditChannelModal
                    channel={channelEditOpen}
                    onClose={closeEditChannel}
                    name={channelEditName}
                    setName={setChannelEditName}
                    description={channelEditDescription}
                    setDescription={setChannelEditDescription}
                    opusBitrate={channelEditOpusBitrate}
                    setOpusBitrate={setChannelEditOpusBitrate}
                    isSaving={isSaving()}
                    onSubmit={(channel, name, description, opusBitrate) =>
                        void handleUpdateChannel(
                            channel,
                            name,
                            description,
                            opusBitrate,
                        )
                    }
                />

                <div class="channel-footer">
                    <Show when={voiceRejoinNotice() && !joinedVoiceChannelId()}>
                        <div
                            class="channel-footer-banner"
                            role="status"
                            aria-live="polite"
                        >
                            <span>
                                Voice disconnected after profile update. Click a
                                voice channel to rejoin.
                            </span>
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
                        <VoiceDock
                            connectedChannelName={connectedVoiceChannelName()}
                            nativeDebugEnabled={nativeDebugEnabled}
                            nativeSenderMetrics={nativeSenderMetrics()}
                            cameraActionPending={cameraActionPending()}
                            screenActionPending={screenActionPending()}
                            onDisconnect={leaveVoiceChannel}
                            onToggleMicMuted={handleToggleMicMuted}
                            onToggleSpeakerMuted={handleToggleSpeakerMuted}
                            onToggleCamera={() => void handleToggleCamera()}
                            onToggleScreenShare={() =>
                                void handleToggleScreenShare()
                            }
                        />
                    </Show>
                    <ScreenShareModal
                        open={
                            tauriRuntime &&
                            screenShareModalOpen() &&
                            !screenShareEnabled()
                        }
                        onClose={closeScreenShareModal}
                        nativeSourcesLoading={nativeSourcesLoading()}
                        nativeSourcesError={nativeSourcesError()}
                        nativeSources={nativeSources()}
                        selectedNativeSourceId={selectedNativeSourceId()}
                        onSelectNativeSource={setSelectedNativeSourceId}
                        screenSharePreviewStream={screenSharePreviewStream()}
                        screenSharePreviewError={screenSharePreviewError()}
                        screenSharePreviewVideoRef={() =>
                            screenSharePreviewVideoRef
                        }
                        onRefreshSources={() =>
                            void loadNativeCaptureSources()
                        }
                        onStartPreview={() => void startScreenSharePreview()}
                        onStopPreview={stopScreenSharePreview}
                        onConfirm={() => void handleConfirmTauriScreenShare()}
                        screenActionPending={screenActionPending()}
                    />
                    <UserSettingsDock />
                </div>
            </AsyncContent>
            <Show when={toastError()}>
                <div class="toast toast-error" role="status" aria-live="polite">
                    {toastError()}
                </div>
            </Show>
        </div>
    );
}
