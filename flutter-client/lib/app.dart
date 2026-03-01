import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'screens/login.dart';
import 'screens/register.dart';
import 'screens/setup.dart';
import 'screens/chat.dart';
import 'screens/settings/settings_screen.dart';
import 'screens/dms/dms_screen.dart';
import 'screens/admin/admin_screen.dart';
import 'state/auth.dart';
import 'theme/app_theme.dart';

final _routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: '/login',
    redirect: (context, state) {
      final isAuthenticated = authState.valueOrNull?.isAuthenticated ?? false;
      final isAuthRoute = state.matchedLocation == '/login' ||
          state.matchedLocation == '/register' ||
          state.matchedLocation == '/setup';

      if (!isAuthenticated && !isAuthRoute) {
        return '/login';
      }
      if (isAuthenticated && isAuthRoute) {
        return '/chat';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/setup',
        builder: (context, state) => const SetupScreen(),
      ),
      GoRoute(
        path: '/chat',
        builder: (context, state) => const ChatScreen(),
        routes: [
          GoRoute(
            path: 'channel/:channelId',
            builder: (context, state) => ChatScreen(
              channelId: state.pathParameters['channelId'],
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/dms',
        builder: (context, state) => const DmsScreen(),
        routes: [
          GoRoute(
            path: ':threadId',
            builder: (context, state) => DmsScreen(
              threadId: state.pathParameters['threadId'],
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/admin',
        builder: (context, state) => const AdminScreen(),
      ),
    ],
  );
});

class FiresideApp extends ConsumerWidget {
  const FiresideApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(_routerProvider);
    return MaterialApp.router(
      title: 'Fireside',
      theme: AppTheme.darkTheme,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
