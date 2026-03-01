import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../theme/app_theme.dart';

// ---- Provider --------------------------------------------------------------

final _gifSearchProvider =
    AsyncNotifierProviderFamily<_GifSearchNotifier, List<String>, String>(
  _GifSearchNotifier.new,
);

class _GifSearchNotifier extends FamilyAsyncNotifier<List<String>, String> {
  @override
  Future<List<String>> build(String arg) async {
    if (arg.isEmpty) return [];
    final raw = await ref.read(httpClientProvider).searchGifs(arg);
    // Server returns objects with a `url` field
    return raw
        .cast<Map<String, dynamic>>()
        .map((e) => e['url'] as String)
        .toList();
  }
}

// ---- Widget ----------------------------------------------------------------

/// GIF picker with search field and 2-column masonry-style result grid.
class GifPicker extends ConsumerStatefulWidget {
  const GifPicker({super.key, required this.onSelect});

  final void Function(String gifUrl) onSelect;

  @override
  ConsumerState<GifPicker> createState() => _GifPickerState();
}

class _GifPickerState extends ConsumerState<GifPicker> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  String _activeQuery = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) {
        setState(() => _activeQuery = value.trim());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 340,
      height: 420,
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
            padding: const EdgeInsets.all(AppSpacing.sm),
            child: TextField(
              controller: _searchController,
              autofocus: true,
              onChanged: _onChanged,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(
                hintText: 'Search GIFs...',
                prefixIcon: Icon(Icons.gif_box_rounded, size: 20),
                isDense: true,
              ),
            ),
          ),

          const Divider(height: 1, color: AppColors.gray5),

          // Results
          Expanded(
            child: _activeQuery.isEmpty
                ? _EmptyState()
                : _GifResults(
                    query: _activeQuery,
                    onSelect: widget.onSelect,
                  ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.gif_box_outlined,
            size: 48,
            color: AppColors.gray7,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Search for GIFs',
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          ),
        ],
      ),
    );
  }
}

class _GifResults extends ConsumerWidget {
  const _GifResults({required this.query, required this.onSelect});

  final String query;
  final void Function(String gifUrl) onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gifAsync = ref.watch(_gifSearchProvider(query));

    return gifAsync.when(
      loading: () => _ShimmerGrid(),
      error: (_, __) => Center(
        child: Text(
          'Could not load GIFs',
          style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
        ),
      ),
      data: (urls) {
        if (urls.isEmpty) {
          return Center(
            child: Text(
              'No GIFs found for "$query"',
              style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
            ),
          );
        }

        return _TwoColumnGrid(urls: urls, onSelect: onSelect);
      },
    );
  }
}

/// Simple 2-column grid for GIF results.
class _TwoColumnGrid extends StatelessWidget {
  const _TwoColumnGrid({required this.urls, required this.onSelect});

  final List<String> urls;
  final void Function(String gifUrl) onSelect;

  @override
  Widget build(BuildContext context) {
    // Distribute into two columns
    final leftUrls = <String>[];
    final rightUrls = <String>[];
    for (int i = 0; i < urls.length; i++) {
      if (i.isEven) {
        leftUrls.add(urls[i]);
      } else {
        rightUrls.add(urls[i]);
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _GifColumn(urls: leftUrls, onSelect: onSelect)),
          const SizedBox(width: AppSpacing.xs),
          Expanded(child: _GifColumn(urls: rightUrls, onSelect: onSelect)),
        ],
      ),
    );
  }
}

class _GifColumn extends StatelessWidget {
  const _GifColumn({required this.urls, required this.onSelect});

  final List<String> urls;
  final void Function(String gifUrl) onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: urls
          .map((url) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                child: _GifTile(url: url, onSelect: onSelect),
              ))
          .toList(),
    );
  }
}

class _GifTile extends StatelessWidget {
  const _GifTile({required this.url, required this.onSelect});

  final String url;
  final void Function(String gifUrl) onSelect;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onSelect(url),
      borderRadius: BorderRadius.all(AppRadius.sm),
      child: ClipRRect(
        borderRadius: BorderRadius.all(AppRadius.sm),
        child: CachedNetworkImage(
          imageUrl: url,
          fit: BoxFit.cover,
          width: double.infinity,
          placeholder: (_, __) => Container(
            height: 80,
            color: AppColors.gray4,
          ),
          errorWidget: (_, __, ___) => Container(
            height: 80,
            color: AppColors.gray4,
            child: const Icon(
              Icons.broken_image_outlined,
              color: AppColors.gray7,
            ),
          ),
        ),
      ),
    );
  }
}

/// Animated shimmer placeholder for loading state.
class _ShimmerGrid extends StatefulWidget {
  @override
  State<_ShimmerGrid> createState() => _ShimmerGridState();
}

class _ShimmerGridState extends State<_ShimmerGrid>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
    _opacity = Tween<double>(begin: 0.3, end: 0.7).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _opacity,
      builder: (_, __) => Opacity(
        opacity: _opacity.value,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xs),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _ShimmerColumn()),
              const SizedBox(width: AppSpacing.xs),
              Expanded(child: _ShimmerColumn(offset: true)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ShimmerColumn extends StatelessWidget {
  const _ShimmerColumn({this.offset = false});

  final bool offset;

  @override
  Widget build(BuildContext context) {
    final heights = offset
        ? [90.0, 60.0, 100.0, 70.0]
        : [60.0, 100.0, 70.0, 90.0];

    return Column(
      children: heights
          .map((h) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                child: Container(
                  height: h,
                  decoration: BoxDecoration(
                    color: AppColors.gray4,
                    borderRadius: BorderRadius.all(AppRadius.sm),
                  ),
                ),
              ))
          .toList(),
    );
  }
}
