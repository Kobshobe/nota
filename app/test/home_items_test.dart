import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/items/items_screen.dart';
import 'package:nota/shared/widgets/quota_badge.dart';

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

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
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
    // 额度徽标只在首页，对话页不该再出现（否则这条断言在 0/10 下会恒真）。
    expect(find.byType(QuotaBadge), findsNothing);
  });

  testWidgets('场景：首页 · 事项页显示额度并可以退出登录', (tester) async {
    final now = DateTime.now().toUtc();
    final daily = NotaThread(
      id: 'thread-daily',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(threads: [daily]);

    await tester.pumpWidget(
      testRoutedApp(
        api: api,
        routes: [
          GoRoute(path: '/', builder: (context, state) => const ItemsScreen()),
        ],
      ),
    );
    await pumpUntil(tester, find.text('事项'));

    expect(find.byIcon(Icons.logout), findsOneWidget);
    // 额度徽标从对话页挪到了首页
    expect(find.text('0 / 10'), findsOneWidget);
  });
}
