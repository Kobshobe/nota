import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/chat/new_meeting_screen.dart';

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

Widget chatApp(FakeApi api, NotaThread daily) {
  return testRoutedApp(
    api: api,
    initialLocation: '/chat/${daily.id}',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const Scaffold(body: Text('首页')),
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
}

void main() {
  testWidgets('场景：会议 · 右上角入口先进空白页，不创建会议数据', (tester) async {
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
    await pumpUntil(tester, find.text('粘贴会议文字'));

    // then：只是空白会议页，服务端没有多出会议
    expect(find.text('新会议'), findsOneWidget);
    expect(
      api.threads.where((item) => item.kind == ThreadKind.meeting),
      isEmpty,
    );
  });

  testWidgets('场景：会议 · 发出第一条消息才创建会议并进入', (tester) async {
    final now = DateTime.now().toUtc();
    final daily = thread('thread-daily', ThreadKind.daily, '日常', now);
    final api = FakeApi(
      threads: [daily],
      detail: ThreadDetail(thread: daily, messages: const []),
    );

    await tester.pumpWidget(chatApp(api, daily));
    await pumpUntil(tester, find.byKey(const ValueKey('start-meeting')));
    await tester.tap(find.byKey(const ValueKey('start-meeting')));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    // when：粘贴会议文字并发送
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '今天聊了三点：预算、排期、人手。',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.byType(ChatScreen));

    // then：会议已创建，页面变成那场会议的对话
    final meetings = api.threads.where(
      (item) => item.kind == ThreadKind.meeting,
    );
    expect(meetings, hasLength(1));
    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.byKey(const ValueKey('start-meeting')), findsNothing);
  });

  testWidgets('场景：会议 · 发送失败停在空白页，重试复用同一场会议', (tester) async {
    final now = DateTime.now().toUtc();
    final daily = thread('thread-daily', ThreadKind.daily, '日常', now);
    final api = FakeApi(
      threads: [daily],
      detail: ThreadDetail(thread: daily, messages: const []),
    )..failFirstSend = true;

    await tester.pumpWidget(chatApp(api, daily));
    await pumpUntil(tester, find.byKey(const ValueKey('start-meeting')));
    await tester.tap(find.byKey(const ValueKey('start-meeting')));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '客户说下周看报价。',
    );
    await tester.pump();

    // when：第一次发送失败
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.textContaining('服务暂时不可用'));

    // then：停在空白会议页
    expect(find.byType(ChatScreen), findsNothing);

    // when：再发一次
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.byType(ChatScreen));

    // then：只有一场会议，两次请求复用同一个 clientMessageId
    expect(
      api.threads.where((item) => item.kind == ThreadKind.meeting),
      hasLength(1),
    );
    expect(api.sends, hasLength(2));
    expect(api.sends[0].clientMessageId, api.sends[1].clientMessageId);
  });

  testWidgets('场景：会议 · 日常时间线里的会议卡片可以回到那场会议', (tester) async {
    final now = DateTime.now().toUtc();
    final daily = thread('thread-daily', ThreadKind.daily, '日常', now);
    final meeting = thread(
      'thread-meeting',
      ThreadKind.meeting,
      '周会',
      now.subtract(const Duration(minutes: 5)),
    );
    final api = FakeApi(
      threads: [daily, meeting],
      detail: ThreadDetail(thread: daily, messages: const []),
    );

    await tester.pumpWidget(chatApp(api, daily));
    await pumpUntil(
      tester,
      find.byKey(const ValueKey('meeting-card-thread-meeting')),
    );

    // when：点时间线里的会议卡片
    await tester.tap(find.byKey(const ValueKey('meeting-card-thread-meeting')));
    await pumpUntil(tester, find.byType(ChatScreen));
    await pumpUntil(tester, find.text('周会'));

    // then：进入那场会议，会议里没有新建会议按钮
    expect(find.text('周会'), findsWidgets);
    expect(find.byKey(const ValueKey('start-meeting')), findsNothing);
  });
}
