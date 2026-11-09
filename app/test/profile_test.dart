import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/login_screen.dart';
import 'package:nota/features/auth/models.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/items/items_screen.dart';
import 'package:nota/features/profile/profile_screen.dart';

import 'test_helpers.dart';

NotaThread dailyThread() {
  final now = DateTime.now().toUtc();
  return NotaThread(
    id: 'thread-daily',
    kind: ThreadKind.daily,
    title: '日常',
    createdAt: now,
    updatedAt: now,
  );
}

/// 带登录重定向的路由，用来验证退出后真的回到登录页。
GoRouter guardedRouter(AuthStore store) {
  return GoRouter(
    initialLocation: '/profile',
    refreshListenable: store,
    redirect: (context, state) {
      final loggedIn = store.isAuthenticated;
      final onLogin = state.matchedLocation == '/login';
      if (!loggedIn) return onLogin ? null : '/login';
      if (onLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/', builder: (context, state) => const ItemsScreen()),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileScreen(),
      ),
    ],
  );
}

void main() {
  testWidgets('场景：我的 · 事项页入口进入账号页并显示邮箱与会员', (tester) async {
    final daily = dailyThread();
    final api = FakeApi(
      threads: [daily],
      detail: ThreadDetail(thread: daily, messages: const []),
    );
    api.usage = Usage(
      used: 7,
      limit: 10,
      unlimited: true,
      date: '2026-11-08',
      resetsAt: DateTime.utc(2026, 11, 9),
    );
    final store = AuthStore(MemoryTokenStorage());
    await store.save(
      'token-1',
      const NotaUser(email: 'vip1@nota.com', isVip: true),
    );

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
        authStore: store,
        routes: [
          GoRoute(path: '/', builder: (context, state) => const ItemsScreen()),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/chat/:threadId',
            builder: (context, state) =>
                ChatScreen(threadId: state.pathParameters['threadId']!),
          ),
        ],
      ),
    );
    await pumpUntil(tester, find.byKey(const ValueKey('open-profile')));

    // when：点右上角「我的」
    await tester.tap(find.byKey(const ValueKey('open-profile')));
    await pumpUntil(tester, find.byKey(const ValueKey('profile-email')));

    // then：账号页显示邮箱、会员和额度
    expect(find.text('vip1@nota.com'), findsOneWidget);
    expect(find.text('VIP · 不限次'), findsOneWidget);
    // 不限次也要显示今天用了几次
    await pumpUntil(tester, find.text('不限次 · 今日已用 7 次'));
  });

  testWidgets('场景：我的 · Free 用户显示今日已用次数', (tester) async {
    final api = FakeApi();
    final store = AuthStore(MemoryTokenStorage());
    await store.save(
      'token-1',
      const NotaUser(email: 'free@nota.com', isVip: false),
    );

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
        authStore: store,
        router: guardedRouter(store),
        routes: const [],
      ),
    );
    await pumpUntil(tester, find.text('0 / 10'));

    expect(find.text('Free 版'), findsOneWidget);
    expect(find.text('0 / 10'), findsOneWidget);
  });

  testWidgets('场景：我的 · 额度加载失败时给出可读文案', (tester) async {
    final api = FakeApi()
      ..usageError = const ApiException(
        code: ApiErrorCode.network,
        message: 'offline',
      );
    final store = AuthStore(MemoryTokenStorage());
    await store.save(
      'token-1',
      const NotaUser(email: 'free@nota.com', isVip: false),
    );

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
        authStore: store,
        router: guardedRouter(store),
        routes: const [],
      ),
    );
    await pumpUntil(tester, find.text('额度加载失败'));

    expect(find.text('额度加载失败'), findsOneWidget);
  });

  testWidgets('场景：我的 · 确认退出后清会话、取消通知并回到登录页', (tester) async {
    final api = FakeApi();
    final notifications = FakeNotificationService();
    final store = AuthStore(
      MemoryTokenStorage(),
      onSessionCleared: notifications.cancelAll,
    );
    await store.save(
      'token-1',
      const NotaUser(email: 'free@nota.com', isVip: false),
    );

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
        authStore: store,
        notifications: notifications,
        router: guardedRouter(store),
        routes: const [],
      ),
    );
    await pumpUntil(tester, find.byKey(const ValueKey('profile-logout')));

    await tester.tap(find.byKey(const ValueKey('profile-logout')));
    await pumpUntil(tester, find.byType(AlertDialog));

    // when：在确认框里点「退出」
    await tester.tap(find.text('退出'));
    await pumpUntil(tester, find.text('登录 / 注册'));

    // then：会话清空、本地通知取消、路由回到登录页
    expect(store.isAuthenticated, isFalse);
    expect(notifications.cancelAllCalls, 1);
    expect(find.byType(LoginScreen), findsOneWidget);
  });
}
