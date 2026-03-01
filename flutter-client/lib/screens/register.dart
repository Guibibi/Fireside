import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/http_client.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../components/overlays/error_banner.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _serverUrlController = TextEditingController();
  final _inviteCodeController = TextEditingController();
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
    _inviteCodeController.dispose();
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
      final data = await client.register(
        inviteCode: _inviteCodeController.text.trim(),
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
      setState(() => _error = _friendlyError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _friendlyError(Object e) {
    final msg = e.toString();
    if (msg.contains('404') || msg.contains('invite')) {
      return 'Invalid invite code. Please check and try again.';
    }
    if (msg.contains('409') || msg.contains('already')) {
      return 'Username already taken. Choose a different one.';
    }
    if (msg.contains('SocketException') || msg.contains('Connection refused')) {
      return 'Could not connect to the server. Check the server URL.';
    }
    return 'Registration failed. Please try again.';
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
                const SizedBox(height: AppSpacing.md),
                _buildFooter(),
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
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.accentSubtle,
            borderRadius: BorderRadius.all(AppRadius.lg),
          ),
          child: const Icon(Icons.local_fire_department_rounded,
              color: AppColors.accent, size: 28),
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          'Join the community',
          style: AppTextStyles.displaySm,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'You need an invite code to register',
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
          _FieldLabel('Server URL'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _serverUrlController,
            keyboardType: TextInputType.url,
            decoration:
                const InputDecoration(hintText: 'https://your-server.example.com'),
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? 'Server URL is required' : null,
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Invite Code'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _inviteCodeController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'Enter your invite code'),
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? 'Invite code is required' : null,
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Username'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _usernameController,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            decoration: const InputDecoration(hintText: '3–32 characters'),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Username is required';
              if (v.trim().length < 3) return 'At least 3 characters';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Display Name (optional)'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _displayNameController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(hintText: 'How others see you'),
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Password'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: _passwordController,
            obscureText: true,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _submit(),
            decoration: const InputDecoration(hintText: 'Choose a strong password'),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Password is required';
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
                  : const Text('Create account'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          'Already have an account? ',
          style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
        ),
        TextButton(
          onPressed: () => context.go('/login'),
          style: TextButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: Text('Sign in', style: AppTextStyles.bodySm),
        ),
      ],
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTextStyles.labelMd.copyWith(color: AppColors.gray10),
    );
  }
}
