import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../core/models.dart';
import '../../theme/app_theme.dart';

// ---- Provider --------------------------------------------------------------

final _customEmojisProvider = FutureProvider<List<CustomEmoji>>((ref) async {
  final raw = await ref.read(httpClientProvider).getCustomEmojis();
  return raw
      .cast<Map<String, dynamic>>()
      .map(CustomEmoji.fromJson)
      .toList();
});

// ---- Emoji data ------------------------------------------------------------

const _unicodeCategories = <_EmojiCategory>[
  _EmojiCategory(name: 'Smileys', emojis: [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
    '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😙', '😚',
  ]),
  _EmojiCategory(name: 'People', emojis: [
    '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤙',
    '👍', '👎', '👏', '🙌', '🤲', '🙏', '💪', '🦾', '🦵', '🦶',
  ]),
  _EmojiCategory(name: 'Objects', emojis: [
    '💻', '🖥️', '🖨️', '⌨️', '🖱️', '📱', '📷', '📸', '📹', '🎥',
    '📚', '📖', '📝', '✏️', '🔑', '🔒', '🔓', '💡', '🔦', '🕯️',
  ]),
  _EmojiCategory(name: 'Nature', emojis: [
    '🌸', '🌺', '🌻', '🌹', '🌷', '🌿', '☘️', '🍀', '🎋', '🌲',
    '🌳', '🌴', '🌵', '🍄', '🌾', '🌱', '🌈', '☀️', '🌤️', '⛅',
  ]),
];

class _EmojiCategory {
  const _EmojiCategory({required this.name, required this.emojis});

  final String name;
  final List<String> emojis;
}

// ---- Widget ----------------------------------------------------------------

/// Emoji picker with Custom and Unicode tabs.
/// [onSelect] is called with a Unicode emoji string.
/// [onSelectCustom] is called with the custom emoji ID.
class EmojiPicker extends ConsumerStatefulWidget {
  const EmojiPicker({
    super.key,
    required this.onSelect,
    required this.onSelectCustom,
  });

  final void Function(String emoji) onSelect;
  final void Function(String emojiId) onSelectCustom;

  @override
  ConsumerState<EmojiPicker> createState() => _EmojiPickerState();
}

class _EmojiPickerState extends ConsumerState<EmojiPicker>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _searchController.addListener(() {
      setState(() => _query = _searchController.text.toLowerCase());
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 340,
      height: 380,
      decoration: BoxDecoration(
        color: AppColors.gray3,
        borderRadius: BorderRadius.all(AppRadius.xl),
        border: Border.all(color: AppColors.gray5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Search field
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.sm,
              AppSpacing.sm,
              AppSpacing.sm,
              0,
            ),
            child: TextField(
              controller: _searchController,
              autofocus: true,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(
                hintText: 'Search emojis...',
                prefixIcon: Icon(Icons.search_rounded, size: 18),
                isDense: true,
              ),
            ),
          ),

          // Tabs
          TabBar(
            controller: _tabController,
            labelColor: AppColors.accent,
            unselectedLabelColor: AppColors.gray9,
            indicatorColor: AppColors.accent,
            indicatorSize: TabBarIndicatorSize.label,
            labelStyle: AppTextStyles.labelMd,
            tabs: const [
              Tab(text: 'Custom'),
              Tab(text: 'Unicode'),
            ],
          ),

          const Divider(height: 1, color: AppColors.gray5),

          // Tab content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _CustomEmojiGrid(
                  query: _query,
                  onSelectCustom: widget.onSelectCustom,
                ),
                _UnicodeEmojiGrid(
                  query: _query,
                  onSelect: widget.onSelect,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Custom tab ------------------------------------------------------------

class _CustomEmojiGrid extends ConsumerWidget {
  const _CustomEmojiGrid({
    required this.query,
    required this.onSelectCustom,
  });

  final String query;
  final void Function(String emojiId) onSelectCustom;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final emojisAsync = ref.watch(_customEmojisProvider);

    return emojisAsync.when(
      loading: () => const Center(
        child: CircularProgressIndicator(color: AppColors.accent, strokeWidth: 2),
      ),
      error: (_, __) => Center(
        child: Text(
          'Could not load emojis',
          style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
        ),
      ),
      data: (emojis) {
        final filtered = query.isEmpty
            ? emojis
            : emojis.where((e) => e.shortcode.contains(query)).toList();

        if (filtered.isEmpty) {
          return Center(
            child: Text(
              'No results',
              style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
            ),
          );
        }

        return GridView.builder(
          padding: const EdgeInsets.all(AppSpacing.sm),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 8,
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
          ),
          itemCount: filtered.length,
          itemBuilder: (context, i) {
            final emoji = filtered[i];
            return Tooltip(
              message: ':${emoji.shortcode}:',
              child: InkWell(
                onTap: () => onSelectCustom(emoji.id),
                borderRadius: BorderRadius.all(AppRadius.sm),
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: CachedNetworkImage(
                    imageUrl: emoji.imageUrl,
                    width: 32,
                    height: 32,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}

// ---- Unicode tab -----------------------------------------------------------

class _UnicodeEmojiGrid extends StatelessWidget {
  const _UnicodeEmojiGrid({
    required this.query,
    required this.onSelect,
  });

  final String query;
  final void Function(String emoji) onSelect;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      children: _unicodeCategories.map((cat) {
        final filtered = query.isEmpty
            ? cat.emojis
            : cat.emojis.where((e) => e.contains(query)).toList();

        if (filtered.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.sm,
                AppSpacing.sm,
                AppSpacing.sm,
                AppSpacing.xs,
              ),
              child: Text(
                cat.name.toUpperCase(),
                style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
              ),
            ),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 8,
                mainAxisSpacing: 2,
                crossAxisSpacing: 2,
              ),
              itemCount: filtered.length,
              itemBuilder: (context, i) {
                final emoji = filtered[i];
                return InkWell(
                  onTap: () => onSelect(emoji),
                  borderRadius: BorderRadius.all(AppRadius.sm),
                  child: Center(
                    child: Text(
                      emoji,
                      style: const TextStyle(fontSize: 22),
                    ),
                  ),
                );
              },
            ),
          ],
        );
      }).toList(),
    );
  }
}
