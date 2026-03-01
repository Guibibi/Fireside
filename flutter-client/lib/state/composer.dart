import 'package:flutter_riverpod/flutter_riverpod.dart';

// ---- State model -----------------------------------------------------------

class ComposerAttachment {
  const ComposerAttachment({
    required this.mediaId,
    required this.filename,
    required this.contentType,
    required this.bytes,
  });

  final String mediaId;
  final String filename;
  final String contentType;
  final List<int> bytes;

  bool get isImage => contentType.startsWith('image/');
}

class ComposerState {
  const ComposerState({
    this.text = '',
    this.attachments = const [],
    this.isUploading = false,
  });

  final String text;
  final List<ComposerAttachment> attachments;
  final bool isUploading;

  ComposerState copyWith({
    String? text,
    List<ComposerAttachment>? attachments,
    bool? isUploading,
  }) {
    return ComposerState(
      text: text ?? this.text,
      attachments: attachments ?? this.attachments,
      isUploading: isUploading ?? this.isUploading,
    );
  }
}

// ---- Notifier --------------------------------------------------------------

class ComposerNotifier extends FamilyNotifier<ComposerState, String> {
  @override
  ComposerState build(String arg) => const ComposerState();

  void setText(String text) {
    state = state.copyWith(text: text);
  }

  void addAttachment(ComposerAttachment attachment) {
    state = state.copyWith(
      attachments: [...state.attachments, attachment],
    );
  }

  void removeAttachment(String mediaId) {
    state = state.copyWith(
      attachments:
          state.attachments.where((a) => a.mediaId != mediaId).toList(),
    );
  }

  void setUploading(bool value) {
    state = state.copyWith(isUploading: value);
  }

  void clear() {
    state = const ComposerState();
  }
}

// ---- Provider --------------------------------------------------------------

/// Composer state keyed by channelId (or DM threadId).
final composerProvider =
    NotifierProvider.family<ComposerNotifier, ComposerState, String>(
  ComposerNotifier.new,
);
