import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _storage = FlutterSecureStorage();
const _keyToken = 'auth_token';
const _keyUserId = 'auth_user_id';
const _keyUsername = 'auth_username';
const _keyRole = 'auth_role';
const _keyServerUrl = 'server_url';

// ---- Providers -------------------------------------------------------------

/// The URL of the Fireside server (persisted in SharedPreferences).
final serverUrlProvider = StateProvider<String>((ref) => '');

/// Current JWT token (null = not authenticated).
final authTokenProvider = StateProvider<String?>((ref) => null);

/// Full auth state, loaded from secure storage at startup.
final authStateProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

// ---- Models ----------------------------------------------------------------

class AuthState {
  const AuthState({
    required this.isAuthenticated,
    this.userId,
    this.username,
    this.role,
    this.serverUrl = '',
  });

  final bool isAuthenticated;
  final String? userId;
  final String? username;
  final String? role;
  final String serverUrl;

  bool get isOperator => role == 'operator';

  static const unauthenticated = AuthState(isAuthenticated: false);
}

// ---- Notifier --------------------------------------------------------------

class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    return _loadFromStorage();
  }

  Future<AuthState> _loadFromStorage() async {
    final token = await _storage.read(key: _keyToken);
    final userId = await _storage.read(key: _keyUserId);
    final username = await _storage.read(key: _keyUsername);
    final role = await _storage.read(key: _keyRole);
    final prefs = await SharedPreferences.getInstance();
    final serverUrl = prefs.getString(_keyServerUrl) ?? '';

    ref.read(serverUrlProvider.notifier).state = serverUrl;

    if (token == null || token.isEmpty) {
      return AuthState.unauthenticated;
    }

    ref.read(authTokenProvider.notifier).state = token;
    return AuthState(
      isAuthenticated: true,
      userId: userId,
      username: username,
      role: role,
      serverUrl: serverUrl,
    );
  }

  /// Call after a successful login/register/setup response.
  Future<void> signIn({
    required String token,
    required String userId,
    required String username,
    required String role,
    required String serverUrl,
  }) async {
    await _storage.write(key: _keyToken, value: token);
    await _storage.write(key: _keyUserId, value: userId);
    await _storage.write(key: _keyUsername, value: username);
    await _storage.write(key: _keyRole, value: role);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyServerUrl, serverUrl);

    ref.read(authTokenProvider.notifier).state = token;
    ref.read(serverUrlProvider.notifier).state = serverUrl;

    state = AsyncData(AuthState(
      isAuthenticated: true,
      userId: userId,
      username: username,
      role: role,
      serverUrl: serverUrl,
    ));
  }

  Future<void> signOut() async {
    await _storage.deleteAll();
    ref.read(authTokenProvider.notifier).state = null;
    state = const AsyncData(AuthState.unauthenticated);
  }

  Future<void> updateServerUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyServerUrl, url);
    ref.read(serverUrlProvider.notifier).state = url;
  }
}
