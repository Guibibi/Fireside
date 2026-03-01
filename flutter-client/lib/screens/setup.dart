import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/http_client.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../components/overlays/error_banner.dart';

/// First-launch setup screen — creates the operator account.
class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key});

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _serverUrlController = TextEditingController();
  final _usernameController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _serverUrlController.text = ref.read(serverUrlProvider);
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _usernameController.dispose();
    _displayNameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final serverUrl = _serverUrlController.text.trim();
      await ref.read(authStateProvider.notifier).updateServerUrl(serverUrl);

      final client = FiresideHttpClient(baseUrl: serverUrl);
      final displayName = _displayNameController.text.trim();
      final data = await client.setup(
        username: _usernameController.text.trim(),
        password: _passwordController.text,
        displayName: displayName.isNotEmpty ? displayName : null,
      );

      await ref.read(authStateProvider.notifier).signIn(
            token: data['token'] as String,
            userId: data['user_id'] as String,
            username: data['username'] as String,
            role: data['role'] as String,
            serverUrl: serverUrl,
          );

      if (mounted) context.go('/chat');
    } catch (e) {
      setState(() => _error = 'Setup failed: ${e.toString()}');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.gray1,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildHeader(),
                const SizedBox(height: AppSpacing.xl),
                if (_error != null) ...[
                  ErrorBanner(message: _error!),
                  const SizedBox(height: AppSpacing.md),
                ],
                _buildForm(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.accentSubtle,
            borderRadius: BorderRadius.all(AppRadius.xl),
          ),
          child: const Icon(Icons.local_fire_department_rounded,
              color: AppColors.accent, size: 32),
        ),
        const SizedBox(height: AppSpacing.md),
        Text('Set up Fireside', style: AppTextStyles.displaySm, textAlign: TextAlign.center),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Create your operator account to get started',
          style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _label('Server URL'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _serverUrlController,
            keyboardType: TextInputType.url,
            decoration:
                const InputDecoration(hintText: 'https://your-server.example.com'),
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? 'Required' : null,
          ),
          const SizedBox(height: AppSpacing.md),
          _label('Username'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _usernameController,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            decoration: const InputDecoration(hintText: '3–32 characters'),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Required';
              if (v.trim().length < 3) return 'At least 3 characters';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _label('Display Name (optional)'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _displayNameController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'Your public name'),
          ),
          const SizedBox(height: AppSpacing.md),
          _label('Password'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _passwordController,
            obscureText: true,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _submit(),
            decoration: const InputDecoration(hintText: 'At least 8 characters'),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Required';
              if (v.length < 8) return 'At least 8 characters';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            height: 44,
            child: ElevatedButton(
              onPressed: _loading ? null : _submit,
              child: _loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: AppColors.gray12),
                    )
                  : const Text('Create operator account'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(String text) {
    return Text(
      text,
      style: AppTextStyles.labelMd.copyWith(color: AppColors.gray10),
    );
  }
}
