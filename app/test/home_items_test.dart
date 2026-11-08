import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/models.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/items/items_screen.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：首页 · 悬浮按钮从事项页进入主对话', (tester) async {
    // given：登录后只有默认的「日常」thread，没有任何会议
    final now = DateTime.now().toUtc();
    final daily = NotaThread(
      id: 'thread-daily',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(
      threads: [daily],
      detail: ThreadDetail(thread: daily, messages: const []),
    );
    api.usage = Usage(
      used: 3,
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
            path: '/chat/:threadId',
            builder: (context, state) =>
                ChatScreen(threadId: state.pathParameters['threadId']!),
          ),
        ],
      ),
    );
    await pumpUntil(tester, find.byKey(const ValueKey('open-daily')));

    // when
    await tester.tap(find.byKey(const ValueKey('open-daily')));
    await pumpUntil(tester, find.text('说点什么'));

    // then：进入主对话，右上角是会议入口而不是额度徽标
    expect(find.text('日常'), findsOneWidget);
    expect(find.byKey(const ValueKey('start-meeting')), findsOneWidget);
    // 额度已移到「我的」，对话页不该出现。
    expect(find.textContaining('VIP'), findsNothing);
    expect(find.text('0 / 10'), findsNothing);
  });

  testWidgets('场景：首页 · 事项页不显示 VIP，右上角只有「我的」', (tester) async {
    final now = DateTime.now().toUtc();
    final daily = NotaThread(
      id: 'thread-daily',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(threads: [daily]);
    // 用 VIP + 不限次，确保「不出现 VIP」不是没数据导致的恒真。
    api.usage = Usage(
      used: 3,
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
        ],
      ),
    );
    await pumpUntil(tester, find.text('事项'));

    expect(find.textContaining('VIP'), findsNothing);
    expect(find.textContaining('3 / 10'), findsNothing);
    expect(find.byIcon(Icons.logout), findsNothing);
    expect(find.byKey(const ValueKey('open-profile')), findsOneWidget);
  });
}
