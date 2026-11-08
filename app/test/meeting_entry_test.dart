import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

NotaThread thread(String id, ThreadKind kind, String title, DateTime at) {
  return NotaThread(
    id: id,
    kind: kind,
    title: title,
    createdAt: at,
    updatedAt: at,
  );
}

Widget chatApp(FakeApi api, NotaThread daily, {String location = ''}) {
  return testRoutedApp(
    api: api,
    initialLocation: location.isEmpty ? '/chat/${daily.id}' : location,
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const Scaffold(body: Text('首页')),
      ),
      GoRoute(
        path: '/chat/:threadId',
        builder: (context, state) =>
            ChatScreen(threadId: state.pathParameters['threadId']!),
      ),
    ],
  );
}

void main() {
  testWidgets('场景：会议 · 主对话右上角按钮直接新建会议，不填标题', (tester) async {
    // given：主对话只有「日常」
    final now = DateTime.now().toUtc();
    final daily = thread('thread-daily', ThreadKind.daily, '日常', now);
    final api = FakeApi(
      threads: [daily],
      detail: ThreadDetail(thread: daily, messages: const []),
    );

    await tester.pumpWidget(chatApp(api, daily));
    await pumpUntil(tester, find.byKey(const ValueKey('start-meeting')));

    // when：点右上角会议按钮
    await tester.tap(find.byKey(const ValueKey('start-meeting')));
    await pumpUntil(tester, find.text('新会议'));

    // then：直接进入新的会议对话，服务端默认标题生效
    expect(find.text('新会议'), findsWidgets);
    expect(
      api.threads.where((item) => item.kind == ThreadKind.meeting),
      hasLength(1),
    );
    expect(find.byKey(const ValueKey('start-meeting')), findsNothing);
  });

  testWidgets('场景：会议 · 主对话里的最近会议卡片可以回到那场会议', (tester) async {
    // given：主对话里有最近两场会议
    final now = DateTime.now().toUtc();
    final daily = thread('thread-daily', ThreadKind.daily, '日常', now);
    final meeting = thread(
      'thread-meeting',
      ThreadKind.meeting,
      '周会',
      now.subtract(const Duration(minutes: 5)),
    );
    final older = thread(
      'thread-older',
      ThreadKind.meeting,
      '复盘会',
      now.subtract(const Duration(days: 1)),
    );
    final api = FakeApi(
      threads: [daily, meeting, older],
      detail: ThreadDetail(thread: daily, messages: const []),
    );

    await tester.pumpWidget(chatApp(api, daily));
    await pumpUntil(tester, find.text('最近会议'));

    // when：点「周会」卡片
    await tester.tap(find.byKey(const ValueKey('meeting-card-thread-meeting')));
    await pumpUntil(tester, find.text('周会'));

    // then：进入那场会议，会议里没有新建会议按钮
    expect(find.text('周会'), findsWidgets);
    expect(find.byKey(const ValueKey('start-meeting')), findsNothing);
  });
}
