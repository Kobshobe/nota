import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：发送失败 · 重试复用同一个 clientMessageId', (tester) async {
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
    )..failFirstSend = true;

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '提醒我半小时后开会',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.text('服务暂时不可用，请稍后重试'));

    await tester.tap(find.text('重试'));
    await pumpUntil(tester, find.text('已记录'));

    expect(api.sends, hasLength(2));
    expect(api.sends[0].clientMessageId, api.sends[1].clientMessageId);

    final input = tester.widget<TextField>(
      find.byKey(const ValueKey('chat-input')),
    );
    expect(input.controller!.text, isEmpty);
  });
}
