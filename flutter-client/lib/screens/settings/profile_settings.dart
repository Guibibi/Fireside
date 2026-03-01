import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/http_client.dart';
import '../../state/auth.dart';
import '../../theme/app_theme.dart';
import '../../components/overlays/user_avatar.dart';

/// Profile settings: display name, bio, status, and avatar upload.
class ProfileSettings extends ConsumerStatefulWidget {
  const ProfileSettings({super.key});

  @override
  ConsumerState<ProfileSettings> createState() => _ProfileSettingsState();
}

class _ProfileSettingsState extends ConsumerState<ProfileSettings> {
  final _displayNameCtrl = TextEditingController();
  final _descriptionCtrl = TextEditingController();
  final _statusCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _saving = false;
  bool _uploadingAvatar = false;
  String? _feedbackMessage;
  bool _feedbackIsError = false;

  @override
  void initState() {
    super.initState();
    _loadCurrentValues();
  }

  void _loadCurrentValues() {
    final auth = ref.read(authStateProvider).valueOrNull;
    if (auth == null) return;
    // The auth state carries minimal info; we'll fetch from the server
    // when the page mounts to populate fields.
    _fetchProfile(auth.username ?? '');
  }

  Future<void> _fetchProfile(String username) async {
    if (username.isEmpty) return;
    try {
      final raw = await ref.read(httpClientProvider).getUserProfile(username);
      if (!mounted) return;
      setState(() {
        _displayNameCtrl.text = raw['display_name'] as String? ?? '';
        _descriptionCtrl.text = raw['profile_description'] as String? ?? '';
        _statusCtrl.text = raw['profile_status'] as String? ?? '';
      });
    } catch (_) {
      // Non-fatal — fields remain empty
    }
  }

  @override
  void dispose() {
    _displayNameCtrl.dispose();
    _descriptionCtrl.dispose();
    _statusCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _feedbackMessage = null;
    });

    try {
      await ref.read(httpClientProvider).updateProfile(
            displayName: _displayNameCtrl.text.trim(),
            profileDescription: _descriptionCtrl.text.trim(),
            profileStatus: _statusCtrl.text.trim(),
          );
      if (!mounted) return;
      setState(() {
        _feedbackMessage = 'Profile saved.';
        _feedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _feedbackMessage = 'Failed to save profile.';
        _feedbackIsError = true;
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickAvatar() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    if (file.bytes == null) return;

    setState(() {
      _uploadingAvatar = true;
      _feedbackMessage = null;
    });

    try {
      await ref.read(httpClientProvider).uploadAvatar(
            file.bytes!,
            file.name,
          );
      if (!mounted) return;
      setState(() {
        _feedbackMessage = 'Avatar updated.';
        _feedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _feedbackMessage = 'Failed to upload avatar.';
        _feedbackIsError = true;
      });
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider).valueOrNull;
    final username = auth?.username ?? '';

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Profile', style: AppTextStyles.displaySm),
            const SizedBox(height: AppSpacing.xl),

            // Avatar
            _SectionLabel('Avatar'),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Stack(
                  children: [
                    UserAvatar(username: username, size: 72),
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: GestureDetector(
                        onTap: _uploadingAvatar ? null : _pickAvatar,
                        child: Container(
                          width: 24,
                          height: 24,
                          decoration: const BoxDecoration(
                            color: AppColors.accent,
                            shape: BoxShape.circle,
                          ),
                          child: _uploadingAvatar
                              ? const Padding(
                                  padding: EdgeInsets.all(4),
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: AppColors.gray12,
                                  ),
                                )
                              : const Icon(
                                  Icons.edit_rounded,
                                  size: 13,
                                  color: AppColors.gray12,
                                ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: AppSpacing.lg),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ElevatedButton(
                      onPressed: _uploadingAvatar ? null : _pickAvatar,
                      child: const Text('Change avatar'),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'JPG, PNG or GIF — max 4 MB',
                      style: AppTextStyles.bodySm.copyWith(
                        color: AppColors.gray9,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: AppSpacing.xl),
            const Divider(color: AppColors.gray5),
            const SizedBox(height: AppSpacing.xl),

            // Display name
            _SectionLabel('Display name'),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _displayNameCtrl,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(hintText: 'Your display name'),
              validator: (v) {
                if (v == null || v.trim().isEmpty) {
                  return 'Display name cannot be empty';
                }
                if (v.trim().length > 64) return 'Max 64 characters';
                return null;
              },
            ),

            const SizedBox(height: AppSpacing.lg),

            // Profile status
            _SectionLabel('Status'),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _statusCtrl,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(
                hintText: 'What are you up to?',
              ),
              maxLength: 128,
              buildCounter: _buildCounter,
            ),

            const SizedBox(height: AppSpacing.lg),

            // Profile description
            _SectionLabel('About me'),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _descriptionCtrl,
              style: AppTextStyles.bodyMd,
              decoration: const InputDecoration(
                hintText: 'A few words about yourself...',
                alignLabelWithHint: true,
              ),
              maxLines: 4,
              maxLength: 512,
              buildCounter: _buildCounter,
            ),

            const SizedBox(height: AppSpacing.xl),

            // Feedback
            if (_feedbackMessage != null)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Text(
                  _feedbackMessage!,
                  style: AppTextStyles.bodyMd.copyWith(
                    color: _feedbackIsError
                        ? AppColors.danger
                        : AppColors.success,
                  ),
                ),
              ),

            // Save button
            ElevatedButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.gray12,
                      ),
                    )
                  : const Text('Save changes'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label.toUpperCase(),
      style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
    );
  }
}

Widget? _buildCounter(
  BuildContext context, {
  required int currentLength,
  required int? maxLength,
  required bool isFocused,
}) {
  if (maxLength == null) return null;
  return Text(
    '$currentLength / $maxLength',
    style: AppTextStyles.bodySm.copyWith(color: AppColors.gray8),
  );
}
