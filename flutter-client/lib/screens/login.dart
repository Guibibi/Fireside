import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/http_client.dart';
import '../state/auth.dart';
import '../theme/app_theme.dart';
import '../components/overlays/error_banner.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _serverUrlController = TextEditingController();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Pre-fill server URL from persisted value
    final serverUrl = ref.read(serverUrlProvider);
    _serverUrlController.text = serverUrl;
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _usernameController.dispose();
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
      final data = await client.login(
        username: _usernameController.text.trim(),
        password: _passwordController.text,
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
    if (msg.contains('401') || msg.contains('Unauthorized')) {
      return 'Invalid username or password.';
    }
    if (msg.contains('SocketException') || msg.contains('Connection refused')) {
      return 'Could not connect to the server. Check the server URL.';
    }
    return 'Login failed. Please try again.';
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
                _Header(),
                const SizedBox(height: AppSpacing.xl),
                if (_error != null) ...[
                  ErrorBanner(message: _error!),
                  const SizedBox(height: AppSpacing.md),
                ],
                _LoginForm(
                  formKey: _formKey,
                  serverUrlController: _serverUrlController,
                  usernameController: _usernameController,
                  passwordController: _passwordController,
                  loading: _loading,
                  onSubmit: _submit,
                ),
                const SizedBox(height: AppSpacing.md),
                _FooterLinks(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
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
          'Welcome back',
          style: AppTextStyles.displaySm.copyWith(color: AppColors.gray12),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Sign in to your Fireside community',
          style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

class _LoginForm extends StatelessWidget {
  const _LoginForm({
    required this.formKey,
    required this.serverUrlController,
    required this.usernameController,
    required this.passwordController,
    required this.loading,
    required this.onSubmit,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController serverUrlController;
  final TextEditingController usernameController;
  final TextEditingController passwordController;
  final bool loading;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _FieldLabel('Server URL'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: serverUrlController,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              hintText: 'https://your-server.example.com',
            ),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Server URL is required';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Username'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: usernameController,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            decoration: const InputDecoration(hintText: 'Enter your username'),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Username is required';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _FieldLabel('Password'),
          const SizedBox(height: AppSpacing.xs),
          TextFormField(
            controller: passwordController,
            obscureText: true,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => onSubmit(),
            decoration: const InputDecoration(hintText: 'Enter your password'),
            validator: (v) {
              if (v == null || v.isEmpty) return 'Password is required';
              return null;
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          SizedBox(
            height: 44,
            child: ElevatedButton(
              onPressed: loading ? null : onSubmit,
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.gray12,
                      ),
                    )
                  : const Text('Sign in'),
            ),
          ),
        ],
      ),
    );
  }
}

class _FooterLinks extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          "Don't have an account? ",
          style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
        ),
        TextButton(
          onPressed: () => context.go('/register'),
          style: TextButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: Text('Register', style: AppTextStyles.bodySm),
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
