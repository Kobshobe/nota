import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/login_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/chat/new_meeting_screen.dart';
import '../features/items/items_screen.dart';
import '../features/profile/profile_screen.dart';
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
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(title: const Text('Nota')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '页面加载失败，请返回重试。',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, height: 1.6),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.go('/'),
                child: const Text('返回'),
              ),
            ],
          ),
        ),
      ),
    ),
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/', builder: (context, state) => const ItemsScreen()),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
      GoRoute(
        path: '/meeting/new',
        builder: (context, state) => const NewMeetingScreen(),
      ),
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
