import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/auth.dart';

/// Provider exposing a fully-configured Dio instance with JWT auth.
final httpClientProvider = Provider<FiresideHttpClient>((ref) {
  final serverUrl = ref.watch(serverUrlProvider);
  final token = ref.watch(authTokenProvider);
  return FiresideHttpClient(baseUrl: serverUrl, token: token);
});

class FiresideHttpClient {
  FiresideHttpClient({required String baseUrl, String? token})
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl.isEmpty ? 'http://localhost:3000' : baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 30),
            headers: {
              if (token != null && token.isNotEmpty)
                'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
          ),
        );

  final Dio _dio;

  // ---- Auth ----------------------------------------------------------------

  Future<Map<String, dynamic>> setupStatus() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/setup-status');
    return res.data!;
  }

  Future<Map<String, dynamic>> setup({
    required String username,
    required String password,
    String? displayName,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/setup',
      data: {
        'username': username,
        'password': password,
        if (displayName != null) 'display_name': displayName,
      },
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/login',
      data: {'username': username, 'password': password},
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> register({
    required String inviteCode,
    required String username,
    required String password,
    String? displayName,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/register',
      data: {
        'invite_code': inviteCode,
        'username': username,
        'password': password,
        if (displayName != null) 'display_name': displayName,
      },
    );
    return res.data!;
  }

  // ---- Channels ------------------------------------------------------------

  Future<List<dynamic>> getChannels() async {
    final res = await _dio.get<List<dynamic>>('/api/channels');
    return res.data!;
  }

  Future<Map<String, dynamic>> createChannel({
    required String name,
    required String kind,
    String? description,
    int? opusBitrate,
    bool? opusDtx,
    bool? opusFec,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/channels',
      data: {
        'name': name,
        'kind': kind,
        if (description != null) 'description': description,
        if (opusBitrate != null) 'opus_bitrate': opusBitrate,
        if (opusDtx != null) 'opus_dtx': opusDtx,
        if (opusFec != null) 'opus_fec': opusFec,
      },
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> updateChannel(
    String channelId, {
    required String name,
    String? description,
    int? opusBitrate,
  }) async {
    final res = await _dio.put<Map<String, dynamic>>(
      '/api/channels/$channelId',
      data: {
        'name': name,
        if (description != null) 'description': description,
        if (opusBitrate != null) 'opus_bitrate': opusBitrate,
      },
    );
    return res.data!;
  }

  Future<void> deleteChannel(String channelId) async {
    await _dio.delete<void>('/api/channels/$channelId');
  }

  Future<void> updateChannelRead(
    String channelId, {
    String? lastReadMessageId,
  }) async {
    await _dio.put<void>(
      '/api/channels/$channelId/read',
      data: {'last_read_message_id': lastReadMessageId},
    );
  }

  // ---- Messages ------------------------------------------------------------

  Future<List<dynamic>> getMessages(
    String channelId, {
    String? before,
    int limit = 50,
  }) async {
    final res = await _dio.get<List<dynamic>>(
      '/api/channels/$channelId/messages',
      queryParameters: {
        if (before != null) 'before': before,
        'limit': limit,
      },
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> sendMessage(
    String channelId, {
    required String content,
    List<String> attachmentMediaIds = const [],
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/channels/$channelId/messages',
      data: {
        'content': content,
        'attachment_media_ids': attachmentMediaIds,
      },
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> editMessage(
    String channelId,
    String messageId, {
    required String content,
  }) async {
    final res = await _dio.put<Map<String, dynamic>>(
      '/api/channels/$channelId/messages/$messageId',
      data: {'content': content},
    );
    return res.data!;
  }

  Future<void> deleteMessage(String channelId, String messageId) async {
    await _dio.delete<void>('/api/channels/$channelId/messages/$messageId');
  }

  // ---- Reactions -----------------------------------------------------------

  Future<void> addReaction(
    String channelId,
    String messageId, {
    String? emojiId,
    String? unicodeEmoji,
  }) async {
    await _dio.post<void>(
      '/api/channels/$channelId/messages/$messageId/reactions',
      data: {
        if (emojiId != null) 'emoji_id': emojiId,
        if (unicodeEmoji != null) 'unicode_emoji': unicodeEmoji,
      },
    );
  }

  Future<void> removeReaction(
    String channelId,
    String messageId, {
    String? emojiId,
    String? unicodeEmoji,
  }) async {
    await _dio.delete<void>(
      '/api/channels/$channelId/messages/$messageId/reactions',
      data: {
        if (emojiId != null) 'emoji_id': emojiId,
        if (unicodeEmoji != null) 'unicode_emoji': unicodeEmoji,
      },
    );
  }

  // ---- DMs -----------------------------------------------------------------

  Future<List<dynamic>> getDmThreads() async {
    final res = await _dio.get<List<dynamic>>('/api/dms');
    return res.data!;
  }

  Future<Map<String, dynamic>> createDmThread(String targetUsername) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/dms',
      data: {'target_username': targetUsername},
    );
    return res.data!;
  }

  Future<List<dynamic>> getDmMessages(
    String threadId, {
    String? before,
    int limit = 50,
  }) async {
    final res = await _dio.get<List<dynamic>>(
      '/api/dms/$threadId/messages',
      queryParameters: {
        if (before != null) 'before': before,
        'limit': limit,
      },
    );
    return res.data!;
  }

  Future<void> sendDmMessage(String threadId, {required String content}) async {
    await _dio.post<void>(
      '/api/dms/$threadId/messages',
      data: {'content': content},
    );
  }

  // ---- Users ---------------------------------------------------------------

  Future<List<dynamic>> getUsers() async {
    final res = await _dio.get<List<dynamic>>('/api/users');
    return res.data!;
  }

  Future<Map<String, dynamic>> getUserProfile(String username) async {
    final res = await _dio.get<Map<String, dynamic>>('/api/users/$username');
    return res.data!;
  }

  Future<Map<String, dynamic>> updateProfile({
    String? displayName,
    String? profileDescription,
    String? profileStatus,
  }) async {
    final res = await _dio.put<Map<String, dynamic>>(
      '/api/users/me',
      data: {
        if (displayName != null) 'display_name': displayName,
        if (profileDescription != null)
          'profile_description': profileDescription,
        if (profileStatus != null) 'profile_status': profileStatus,
      },
    );
    return res.data!;
  }

  Future<Map<String, dynamic>> uploadAvatar(List<int> bytes, String filename) async {
    final formData = FormData.fromMap({
      'avatar': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final res = await _dio.put<Map<String, dynamic>>(
      '/api/users/me/avatar',
      data: formData,
    );
    return res.data!;
  }

  // ---- Media uploads -------------------------------------------------------

  Future<Map<String, dynamic>> uploadMedia(
    List<int> bytes,
    String filename,
    String contentType,
  ) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: filename,
        contentType: DioMediaType.parse(contentType),
      ),
    });
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/media',
      data: formData,
    );
    return res.data!;
  }

  // ---- Emojis --------------------------------------------------------------

  Future<List<dynamic>> getCustomEmojis() async {
    final res = await _dio.get<List<dynamic>>('/api/emojis');
    return res.data!;
  }

  Future<Map<String, dynamic>> uploadEmoji({
    required String shortcode,
    required List<int> bytes,
    required String filename,
  }) async {
    final formData = FormData.fromMap({
      'shortcode': shortcode,
      'image': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/emojis',
      data: formData,
    );
    return res.data!;
  }

  Future<void> deleteEmoji(String emojiId) async {
    await _dio.delete<void>('/api/emojis/$emojiId');
  }

  // ---- GIFs ----------------------------------------------------------------

  Future<List<dynamic>> searchGifs(String query, {int limit = 20}) async {
    final res = await _dio.get<List<dynamic>>(
      '/api/gifs/search',
      queryParameters: {'q': query, 'limit': limit},
    );
    return res.data!;
  }

  // ---- Invites -------------------------------------------------------------

  Future<List<dynamic>> getInvites() async {
    final res = await _dio.get<List<dynamic>>('/api/invites');
    return res.data!;
  }

  Future<Map<String, dynamic>> createInvite() async {
    final res = await _dio.post<Map<String, dynamic>>('/api/invites');
    return res.data!;
  }

  Future<void> deleteInvite(String inviteId) async {
    await _dio.delete<void>('/api/invites/$inviteId');
  }

  // ---- Settings ------------------------------------------------------------

  Future<Map<String, dynamic>> getServerSettings() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/settings');
    return res.data!;
  }

  Future<Map<String, dynamic>> updateServerSettings(
    Map<String, dynamic> settings,
  ) async {
    final res = await _dio.put<Map<String, dynamic>>(
      '/api/settings',
      data: settings,
    );
    return res.data!;
  }
}
