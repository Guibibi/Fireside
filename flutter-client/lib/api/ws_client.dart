import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../state/auth.dart';
import 'ws_messages.dart';

enum WsStatus { disconnected, connecting, connected, reconnecting }

/// Provider for the singleton WebSocket client.
final wsClientProvider = Provider<WsClient>((ref) {
  final client = WsClient(ref);
  ref.onDispose(client.dispose);
  return client;
});

/// Stream of server messages — subscribe to receive real-time events.
final wsMessageStreamProvider = StreamProvider<ServerMessage>((ref) {
  return ref.watch(wsClientProvider).messages;
});

/// WebSocket connection status.
final wsStatusProvider = StateProvider<WsStatus>((ref) => WsStatus.disconnected);

class WsClient {
  WsClient(this._ref);

  final Ref _ref;

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;

  final _controller = StreamController<ServerMessage>.broadcast();
  Stream<ServerMessage> get messages => _controller.stream;

  bool _disposed = false;
  int _reconnectAttempts = 0;
  static const _maxReconnectDelay = Duration(seconds: 30);

  void connect() {
    if (_disposed) return;
    _setStatus(WsStatus.connecting);
    _doConnect();
  }

  void _doConnect() {
    final serverUrl = _ref.read(serverUrlProvider);
    final token = _ref.read(authTokenProvider);

    if (serverUrl.isEmpty || token == null || token.isEmpty) {
      _setStatus(WsStatus.disconnected);
      return;
    }

    final wsUrl = serverUrl
        .replaceFirst(RegExp(r'^http'), 'ws')
        .replaceFirst(RegExp(r'/$'), '');

    try {
      _channel = WebSocketChannel.connect(Uri.parse('$wsUrl/ws'));
      _subscription = _channel!.stream.listen(
        _onData,
        onError: _onError,
        onDone: _onDone,
      );

      // Authenticate immediately on connect
      send(AuthenticateMessage(token: token));
      _startHeartbeat();
      _reconnectAttempts = 0;
      _setStatus(WsStatus.connected);
    } catch (e) {
      _scheduleReconnect();
    }
  }

  void _onData(dynamic raw) {
    try {
      final json = jsonDecode(raw as String) as Map<String, dynamic>;
      final msg = ServerMessage.fromJson(json);
      _controller.add(msg);
    } catch (e) {
      // Ignore malformed messages
    }
  }

  void _onError(Object error) {
    _cleanup();
    _scheduleReconnect();
  }

  void _onDone() {
    _cleanup();
    if (!_disposed) {
      _scheduleReconnect();
    }
  }

  void _cleanup() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _subscription?.cancel();
    _subscription = null;
    _channel = null;
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _setStatus(WsStatus.reconnecting);
    _reconnectAttempts++;
    final delay = Duration(
      milliseconds: (_reconnectAttempts * 1000).clamp(
        1000,
        _maxReconnectDelay.inMilliseconds,
      ),
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, _doConnect);
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      send(HeartbeatMessage());
    });
  }

  void send(ClientMessage message) {
    try {
      _channel?.sink.add(message.toJsonString());
    } catch (_) {
      // Channel not open; will reconnect
    }
  }

  void disconnect() {
    _reconnectTimer?.cancel();
    _cleanup();
    _setStatus(WsStatus.disconnected);
  }

  void _setStatus(WsStatus status) {
    if (!_disposed) {
      _ref.read(wsStatusProvider.notifier).state = status;
    }
  }

  void dispose() {
    _disposed = true;
    disconnect();
    _controller.close();
  }
}
