import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../api/ws_client.dart';
import '../api/ws_messages.dart';
import '../core/models.dart';

// ---- Provider --------------------------------------------------------------

final voiceStateProvider = AsyncNotifierProvider<VoiceNotifier, VoiceState>(
  VoiceNotifier.new,
);

// ---- State model -----------------------------------------------------------

class VoiceState {
  const VoiceState({
    this.channelId,
    this.micMuted = false,
    this.speakerMuted = false,
    this.participants = const {},
  });

  final String? channelId;
  final bool micMuted;
  final bool speakerMuted;
  final Map<String, VoiceParticipant> participants;

  bool get inChannel => channelId != null;

  VoiceState copyWith({
    String? channelId,
    bool clearChannel = false,
    bool? micMuted,
    bool? speakerMuted,
    Map<String, VoiceParticipant>? participants,
  }) {
    return VoiceState(
      channelId: clearChannel ? null : (channelId ?? this.channelId),
      micMuted: micMuted ?? this.micMuted,
      speakerMuted: speakerMuted ?? this.speakerMuted,
      participants: participants ?? this.participants,
    );
  }
}

// ---- Notifier --------------------------------------------------------------

class VoiceNotifier extends AsyncNotifier<VoiceState> {
  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;
  StreamSubscription<ServerMessage>? _wsSub;

  static const _iceServers = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
    ],
  };

  static const _mediaConstraints = {
    'audio': {
      'echoCancellation': true,
      'noiseSuppression': true,
      'autoGainControl': true,
    },
    'video': false,
  };

  @override
  Future<VoiceState> build() async {
    _wsSub = ref.watch(wsMessageStreamProvider.stream).listen(_onWsMessage);
    ref.onDispose(() {
      _wsSub?.cancel();
      _closeConnection();
    });
    return const VoiceState();
  }

  Future<void> joinChannel(String channelId) async {
    final current = state.valueOrNull;
    if (current?.channelId == channelId) return;

    // Leave existing channel first
    if (current?.channelId != null) {
      await leaveChannel();
    }

    state = AsyncData(
      (state.valueOrNull ?? const VoiceState()).copyWith(
        channelId: channelId,
        participants: const {},
      ),
    );

    // Send WS join
    ref.read(wsClientProvider).send(JoinVoiceMessage(channelId: channelId));

    // Initialize WebRTC peer connection
    _peerConnection = await createPeerConnection(_iceServers);

    _peerConnection!.onIceCandidate = (candidate) {
      if (candidate.candidate != null) {
        ref.read(wsClientProvider).send(
          MediaSignalClientMsg(
            channelId: channelId,
            payload: {
              'type': 'ice_candidate',
              'candidate': candidate.toMap(),
            },
          ),
        );
      }
    };

    _peerConnection!.onConnectionState = (RTCPeerConnectionState connectionState) {
      // Handle connection state changes
    };

    // Get user mic
    try {
      _localStream = await navigator.mediaDevices.getUserMedia(_mediaConstraints);
      for (final track in _localStream!.getAudioTracks()) {
        await _peerConnection!.addTrack(track, _localStream!);
      }
    } catch (_) {
      // Mic permission denied or unavailable — continue without audio
    }
  }

  Future<void> leaveChannel() async {
    final current = state.valueOrNull;
    if (current?.channelId == null) return;

    ref.read(wsClientProvider).send(
      LeaveVoiceMessage(channelId: current!.channelId!),
    );

    await _closeConnection();

    state = AsyncData(
      (state.valueOrNull ?? const VoiceState()).copyWith(
        clearChannel: true,
        participants: const {},
      ),
    );
  }

  Future<void> toggleMic() async {
    final current = state.valueOrNull;
    if (current == null || current.channelId == null) return;

    final newMuted = !current.micMuted;

    // Mute/unmute local audio tracks
    if (_localStream != null) {
      for (final track in _localStream!.getAudioTracks()) {
        track.enabled = !newMuted;
      }
    }

    // Notify server
    ref.read(wsClientProvider).send(
      VoiceMuteStateMessage(
        channelId: current.channelId!,
        micMuted: newMuted,
        speakerMuted: current.speakerMuted,
      ),
    );

    state = AsyncData(current.copyWith(micMuted: newMuted));
  }

  Future<void> toggleSpeaker() async {
    final current = state.valueOrNull;
    if (current == null) return;

    final newMuted = !current.speakerMuted;
    state = AsyncData(current.copyWith(speakerMuted: newMuted));
  }

  void _onWsMessage(ServerMessage msg) {
    final current = state.valueOrNull;
    if (current == null) return;

    switch (msg) {
      case VoiceUserJoinedMsg(:final channelId, :final username, :final micMuted, :final speakerMuted):
        if (channelId != current.channelId) return;
        final updated = Map<String, VoiceParticipant>.from(current.participants);
        updated[username] = VoiceParticipant(
          username: username,
          muteState: VoiceMuteState(micMuted: micMuted, speakerMuted: speakerMuted),
        );
        state = AsyncData(current.copyWith(participants: updated));

      case VoiceUserLeftMsg(:final channelId, :final username):
        if (channelId != current.channelId) return;
        final updated = Map<String, VoiceParticipant>.from(current.participants);
        updated.remove(username);
        state = AsyncData(current.copyWith(participants: updated));

      case VoiceUserSpeakingMsg(:final channelId, :final username, :final speaking):
        if (channelId != current.channelId) return;
        final updated = Map<String, VoiceParticipant>.from(current.participants);
        final participant = updated[username];
        if (participant != null) {
          updated[username] = participant.copyWith(speaking: speaking);
          state = AsyncData(current.copyWith(participants: updated));
        }

      case VoiceUserMuteStateMsg(:final channelId, :final username, :final micMuted, :final speakerMuted):
        if (channelId != current.channelId) return;
        final updated = Map<String, VoiceParticipant>.from(current.participants);
        final participant = updated[username];
        if (participant != null) {
          updated[username] = participant.copyWith(
            muteState: VoiceMuteState(micMuted: micMuted, speakerMuted: speakerMuted),
          );
          state = AsyncData(current.copyWith(participants: updated));
        }

      case MediaSignalServerMsg(:final channelId, :final payload):
        if (channelId != current.channelId) return;
        _handleMediaSignal(channelId, payload);

      default:
        break;
    }
  }

  Future<void> _handleMediaSignal(
    String channelId,
    Map<String, dynamic> payload,
  ) async {
    if (_peerConnection == null) return;

    final type = payload['type'] as String?;
    switch (type) {
      case 'offer':
        final sdp = payload['sdp'] as String?;
        if (sdp == null) return;
        await _peerConnection!.setRemoteDescription(
          RTCSessionDescription(sdp, 'offer'),
        );
        final answer = await _peerConnection!.createAnswer();
        await _peerConnection!.setLocalDescription(answer);
        ref.read(wsClientProvider).send(
          MediaSignalClientMsg(
            channelId: channelId,
            payload: {
              'type': 'answer',
              'sdp': answer.sdp,
            },
          ),
        );

      case 'answer':
        final sdp = payload['sdp'] as String?;
        if (sdp == null) return;
        await _peerConnection!.setRemoteDescription(
          RTCSessionDescription(sdp, 'answer'),
        );

      case 'ice_candidate':
        final candidate = payload['candidate'] as Map<String, dynamic>?;
        if (candidate == null) return;
        await _peerConnection!.addCandidate(
          RTCIceCandidate(
            candidate['candidate'] as String?,
            candidate['sdpMid'] as String?,
            candidate['sdpMLineIndex'] as int?,
          ),
        );
    }
  }

  Future<void> _closeConnection() async {
    _localStream?.getTracks().forEach((t) => t.stop());
    _localStream?.dispose();
    _localStream = null;

    await _peerConnection?.close();
    _peerConnection = null;
  }
}
