import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：额度 · 今日额度用尽时显示重置时间并保留输入', (tester) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-1',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(
      threads: [thread],
      detail: ThreadDetail(thread: thread, messages: const []),
    );
    api.usage = Usage(
      used: 10,
      limit: 10,
      unlimited: false,
      date: '2026-11-08',
      resetsAt: DateTime.now().add(const Duration(hours: 2)).toUtc(),
    );
    api.sendError = ApiException(
      code: ApiErrorCode.quotaExceeded,
      message: 'Daily quota exhausted',
      statusCode: 429,
      retryAfter: const Duration(hours: 2),
    );

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    await tester.enterText(find.byKey(const ValueKey('chat-input')), '再记一条');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.textContaining('今日额度已用完'));

    expect(find.textContaining('重置'), findsOneWidget);
    expect(find.text('重试'), findsNothing);

    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('chat-input')),
    );
    expect(input.controller!.text, '再记一条');
  });
}
