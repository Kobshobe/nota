import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/login_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/shell/app_shell.dart';
import 'auth_store.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authStore = ref.watch(authStoreProvider);
  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: authStore,
    redirect: (context, state) {
      final loggedIn = authStore.isAuthenticated;
      final onLogin = state.matchedLocation == '/login';
      if (!loggedIn) return onLogin ? null : '/login';
      if (onLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/', builder: (context, state) => const AppShell()),
      GoRoute(
        path: '/chat/:threadId',
        builder: (context, state) =>
            ChatScreen(threadId: state.pathParameters['threadId']!),
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
