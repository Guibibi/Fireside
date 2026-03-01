import {
    For,
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
} from "solid-js";
import { username as currentUsername } from "../stores/auth";
import { del, patch as patchRequest, post } from "../api/http";
import { listChannels, markChannelRead } from "../api/channels";
import { listDmThreads } from "../api/dms";
import {
    cleanupMediaTransports,
    initializeMediaTransports,
    retryAudioPlayback,
    startLocalCameraProducer,
    stopLocalCameraProducer,
    setMicrophoneMuted,
    setSpeakersMuted,
    subscribeAudioPlaybackError,
} from "../api/media";
import {
    createPlainTransport,
    requestMediaSignal,
} from "../api/media/signaling";
import {
    type CaptureSourceKind,
    startCapture,
    stopCapture,
    onCaptureStateChanged,
} from "../api/media/nativeBridge";
import ScreenShareModal from "./ScreenShareModal";
import { connect, onClose, onMessage, send } from "../api/ws";
import {
    activeChannelId,
    activeDmThreadId,
    Channel,
    clearUnread,
    initializeUnreadCounts,
    incrementUnread,
    removeUnreadChannel,
    setActiveDmThread,
    setActiveTextChannel,
    unreadCount,
    closeMobileNav,
} from "../stores/chat";
import {
    closeSettings,
    settingsOpen,
} from "../stores/settings";
import { errorMessage } from "../utils/error";
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
    applyVoiceMuteState,
    applyVoiceSpeaking,
    applyVoiceSnapshot,
    clearVoiceRejoinNotice,
    clearVoiceCameraError,
    cameraEnabled,
    getLastVoiceChannelBeforeDisconnect,
    isVoiceMemberSpeaking,
    joinedVoiceChannelId,
    micMuted,
    participantsByChannel,
    resetVoiceMediaState,
    removeVoiceChannelState,
    setJoinedVoiceChannel,
    setLastVoiceChannelBeforeDisconnect,
    setVoiceCameraError,
    setVoiceActionState,
    speakerMuted,
    startCameraStateSubscription,
    startConnectionStatusSubscription,
    startTransportHealthSubscription,
    startVideoTilesSubscription,
    stopConnectionStatusSubscription,
    stopTransportHealthSubscription,
    showVoiceRejoinNotice,
    toggleMicMuted,
    toggleSpeakerMuted,
    voiceMemberMuteState,
    voiceRejoinNotice,
    voiceActionState,
    screenSharing,
    setScreenSharing,
    setScreenShareError,
    setWatchedScreenProducerId,
    videoTiles,
    watchedScreenProducerId,
} from "../stores/voice";
import AsyncContent from "./AsyncContent";
import UserSettingsDock from "./UserSettingsDock";
import { MicrophoneIcon, PlusIcon, SpeakerIcon } from "./icons";
import {
    ChannelRow,
    CreateChannelModal,
    EditChannelModal,
    VoiceDock,
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
    return listChannels();
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
    const [audioFixNeeded, setAudioFixNeeded] = createSignal(false);
    const [cameraActionPending, setCameraActionPending] = createSignal(false);
    const [showScreenShareModal, setShowScreenShareModal] = createSignal(false);
    let screenProducerId: string | null = null;
    let unsubscribeCaptureState: (() => void) | null = null;
    const [pulsingByChannel, setPulsingByChannel] = createSignal<
        Record<string, boolean>
    >({});
    const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const readMarkerInFlightByChannel = new Set<string>();
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    let channelCreateNameInputRef: HTMLInputElement | undefined;

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

    function handleToggleScreenShare() {
        if (screenSharing()) {
            void handleStopScreenShare();
        } else {
            setShowScreenShareModal(true);
        }
    }

    async function handleStartScreenShare(source: CaptureSourceKind) {
        const channelId = joinedVoiceChannelId();
        if (!channelId) throw new Error("Not in a voice channel");

        setScreenShareError(null);
        screenProducerId = null;

        let captureStarted = false;
        let producedId: string | null = null;

        try {
            // 1. Create PlainTransport on the server.
            const pt = await createPlainTransport(channelId);
            // 2. Start Tauri capture -> sender streams RTP directly to PlainTransport.
            const captureState = await startCapture({
                source,
                server_ip: pt.ip,
                server_port: pt.port,
                bitrate_kbps: 4000,
            });
            captureStarted = true;

            if (captureState.state === "failed") {
                throw new Error(
                    captureState.error?.message ??
                        "Capture pipeline failed to start",
                );
            }

            // 3. Produce on PlainTransport (comedia learns the sender tuple from RTP packets).
            const produceResponse = await requestMediaSignal(
                channelId,
                "media_produce",
                {
                    kind: "video",
                    source: "screen",
                    routing_mode: "sfu",
                    screen_capture_kind: source.kind,
                    screen_capture_label:
                        source.kind === "window" ? source.title : source.name,
                    rtp_parameters: buildScreenRtpParameters(),
                },
            );

            producedId = produceResponse.producer_id ?? null;
            if (!producedId) {
                throw new Error("Unexpected media_produce response from server");
            }

            screenProducerId = producedId;
            setScreenSharing(true);

            // 4. Subscribe to capture state events for error handling.
            unsubscribeCaptureState = await onCaptureStateChanged((event) => {
                if (event.state === "failed") {
                    setScreenShareError(event.error?.message ?? "Capture failed");
                    void handleStopScreenShare();
                }
            });
        } catch (error) {
            if (unsubscribeCaptureState) {
                unsubscribeCaptureState();
                unsubscribeCaptureState = null;
            }

            if (channelId && producedId) {
                try {
                    await requestMediaSignal(channelId, "media_close_producer", {
                        producer_id: producedId,
                    });
                } catch {
                    // Ignore producer close errors during rollback.
                }
            }

            if (captureStarted) {
                try {
                    await stopCapture();
                } catch {
                    // Ignore capture stop errors during rollback.
                }
            }

            screenProducerId = null;
            setScreenSharing(false);
            throw error;
        }
    }

    async function handleStopScreenShare() {
        if (unsubscribeCaptureState) {
            unsubscribeCaptureState();
            unsubscribeCaptureState = null;
        }

        const channelId = joinedVoiceChannelId();
        const producerId = screenProducerId;
        screenProducerId = null;

        try {
            await stopCapture();
        } catch {
            // Ignore stop errors.
        }

        // Close the server-side producer (which also cleans up the PlainTransport).
        if (channelId && producerId) {
            try {
                await requestMediaSignal(channelId, "media_close_producer", {
                    producer_id: producerId,
                });
            } catch {
                // Ignore close errors.
            }
        }

        setScreenSharing(false);
    }

    function buildScreenRtpParameters() {
        return {
            codecs: [
                {
                    mimeType: "video/H264",
                    payloadType: 96,
                    clockRate: 90000,
                    parameters: {
                        "level-asymmetry-allowed": 1,
                        "packetization-mode": 1,
                        "profile-level-id": "42e01f",
                    },
                },
            ],
            headerExtensions: [],
            encodings: [{ ssrc: 0x12345678 }],
            rtcp: {
                reducedSize: true,
            },
        };
    }

    function liveScreenTileForMember(memberUsername: string) {
        return (
            videoTiles().find(
                (tile) =>
                    tile.source === "screen" &&
                    tile.username === memberUsername,
            ) ?? null
        );
    }

    function liveStreamTooltip(tile: {
        username: string;
        screenCaptureKind?: string;
        screenCaptureLabel?: string;
    }): string {
        if (tile.screenCaptureLabel) {
            if (tile.screenCaptureKind === "window") {
                return `Window: ${tile.screenCaptureLabel}`;
            }
            if (tile.screenCaptureKind === "monitor") {
                return `Screen: ${tile.screenCaptureLabel}`;
            }
            return `Source: ${tile.screenCaptureLabel}`;
        }

        return `${displayNameFor(tile.username)} is streaming live`;
    }

    function selectChannel(channel: Channel) {
        if (channel.kind === "voice") {
            joinVoiceChannel(channel.id);
            return;
        }

        if (settingsOpen()) {
            closeSettings();
        }
        closeMobileNav();

        setActiveTextChannel(channel.id);
        markChannelReadOptimistically(channel.id);
    }

    function clearActiveChannelUnread() {
        const selected = activeChannelId();
        if (selected) {
            markChannelReadOptimistically(selected);
        }
    }

    function markChannelReadOptimistically(channelId: string) {
        clearUnread(channelId);
        if (readMarkerInFlightByChannel.has(channelId)) {
            return;
        }

        readMarkerInFlightByChannel.add(channelId);
        void markChannelRead(channelId, null)
            .catch(() => undefined)
            .finally(() => {
                readMarkerInFlightByChannel.delete(channelId);
            });
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
        closeMobileNav();

        setActiveDmThread(threadId);
        setDmUnreadCount(threadId, 0);
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
            initializeUnreadCounts(
                loaded.map((channel) => ({
                    channelId: channel.id,
                    unreadCount: channel.unread_count,
                })),
            );

            const sorted = loaded
                .map(({ unread_count: _unreadCount, ...channel }) => channel)
                .sort((a, b) => a.position - b.position);
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
        startTransportHealthSubscription();
        const unsubscribeAudioError = subscribeAudioPlaybackError(() => {
            setAudioFixNeeded(true);
        });
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
            if (msg.type === "authenticated") {
                const channelToRejoin = getLastVoiceChannelBeforeDisconnect();
                if (channelToRejoin && !joinedVoiceChannelId() && voiceActionState() === "idle") {
                    setLastVoiceChannelBeforeDisconnect(null);
                    joinVoiceChannel(channelToRejoin);
                } else if (channelToRejoin) {
                    setLastVoiceChannelBeforeDisconnect(null);
                    showVoiceRejoinNotice();
                }
                return;
            }

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
                    void handleStopScreenShare();
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
                applyVoiceJoined(msg.channel_id, msg.username, {
                    micMuted: msg.mic_muted,
                    speakerMuted: msg.speaker_muted,
                });
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

            if (msg.type === "voice_user_mute_state") {
                applyVoiceMuteState(msg.channel_id, msg.username, {
                    micMuted: msg.mic_muted,
                    speakerMuted: msg.speaker_muted,
                });
                return;
            }

            if (msg.type === "voice_joined") {
                playVoiceJoinCue();
                setJoinedVoiceChannel(msg.channel_id);
                startCameraStateSubscription();
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
                    void handleStopScreenShare();
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
            const currentVoiceChannel = joinedVoiceChannelId();
            if (!currentVoiceChannel) {
                return;
            }

            void handleStopScreenShare();
            setLastVoiceChannelBeforeDisconnect(currentVoiceChannel);
            cleanupMediaTransports();
            setJoinedVoiceChannel(null);
            resetVoiceMediaState();
            setVoiceActionState("idle");
        });

        onCleanup(() => {
            void handleStopScreenShare();
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
            unsubscribeAudioError();
            stopConnectionStatusSubscription();
            stopTransportHealthSubscription();
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
                                                                    when={liveScreenTileForMember(memberUsername)}
                                                                >
                                                                    {(tile) => {
                                                                        const isWatching = () =>
                                                                            watchedScreenProducerId() ===
                                                                            tile().producerId;

                                                                        return (
                                                                            <>
                                                                                <span
                                                                                    class="channel-voice-member-live-badge"
                                                                                    title={liveStreamTooltip(tile())}
                                                                                    aria-label={`${displayNameFor(memberUsername)} is live`}
                                                                                >
                                                                                    LIVE
                                                                                </span>
                                                                                <button
                                                                                    type="button"
                                                                                    class={`channel-voice-member-watch${isWatching() ? " is-active" : ""}`}
                                                                                    title={
                                                                                        isWatching()
                                                                                            ? "Stop watching stream"
                                                                                            : `Watch stream (${liveStreamTooltip(tile())})`
                                                                                    }
                                                                                    onClick={(event) => {
                                                                                        event.preventDefault();
                                                                                        event.stopPropagation();
                                                                                        setWatchedScreenProducerId(
                                                                                            isWatching()
                                                                                                ? null
                                                                                                : tile().producerId,
                                                                                        );
                                                                                    }}
                                                                                >
                                                                                    {isWatching()
                                                                                        ? "Watching"
                                                                                        : "Watch"}
                                                                                </button>
                                                                            </>
                                                                        );
                                                                    }}
                                                                </Show>
                                                                <Show
                                                                    when={
                                                                        voiceMemberMuteState(channel.id, memberUsername)
                                                                            .micMuted ||
                                                                        voiceMemberMuteState(channel.id, memberUsername)
                                                                            .speakerMuted
                                                                    }
                                                                >
                                                                    <span
                                                                        class="channel-voice-member-mute-icons"
                                                                        role="group"
                                                                        aria-label={`${displayNameFor(memberUsername)} mute status`}
                                                                    >
                                                                        <Show
                                                                            when={voiceMemberMuteState(channel.id, memberUsername).micMuted}
                                                                        >
                                                                            <span
                                                                                class="channel-voice-member-mute-icon"
                                                                                title="Microphone muted"
                                                                                aria-label="Microphone muted"
                                                                            >
                                                                                <MicrophoneIcon muted class="channel-voice-member-mute-glyph" />
                                                                            </span>
                                                                        </Show>
                                                                        <Show
                                                                            when={voiceMemberMuteState(channel.id, memberUsername).speakerMuted}
                                                                        >
                                                                            <span
                                                                                class="channel-voice-member-mute-icon"
                                                                                title="Speaker muted"
                                                                                aria-label="Speaker muted"
                                                                            >
                                                                                <SpeakerIcon muted class="channel-voice-member-mute-glyph" />
                                                                            </span>
                                                                        </Show>
                                                                    </span>
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
                            cameraActionPending={cameraActionPending()}
                            onDisconnect={leaveVoiceChannel}
                            onToggleMicMuted={handleToggleMicMuted}
                            onToggleSpeakerMuted={handleToggleSpeakerMuted}
                            onToggleCamera={() => void handleToggleCamera()}
                            onToggleScreenShare={handleToggleScreenShare}
                        />
                    </Show>
                    <ScreenShareModal
                        open={showScreenShareModal()}
                        onClose={() => setShowScreenShareModal(false)}
                        onStartSharing={(source) => handleStartScreenShare(source)}
                    />
                    <UserSettingsDock />
                </div>
            </AsyncContent>
            <Show when={toastError()}>
                <div class="toast toast-error" role="status" aria-live="polite">
                    {toastError()}
                </div>
            </Show>
            <Show when={audioFixNeeded()}>
                <div class="toast toast-audio-fix" role="alert" aria-live="assertive">
                    <span>Can't hear others?</span>
                    <button
                        class="toast-audio-fix-btn"
                        onClick={async () => {
                            const ok = await retryAudioPlayback();
                            if (ok) {
                                setAudioFixNeeded(false);
                            }
                        }}
                    >
                        Fix Audio
                    </button>
                    <button
                        class="toast-audio-fix-dismiss"
                        onClick={() => setAudioFixNeeded(false)}
                        aria-label="Dismiss"
                    >
                        &times;
                    </button>
                </div>
            </Show>
        </div>
    );
}
