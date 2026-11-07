import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

NotaThread _dailyThread() {
  final now = DateTime.now().toUtc();
  return NotaThread(
    id: 'thread-1',
    kind: ThreadKind.daily,
    title: '日常',
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  testWidgets('场景：日常对话 · 发送消息后显示助手整理结果', (tester) async {
    final thread = _dailyThread();
    final api = FakeApi(
      threads: [thread],
      detail: ThreadDetail(thread: thread, messages: const []),
    )..sendGate = Completer<void>();

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '记一下明天买牛奶',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();

    expect(find.text('整理中…'), findsOneWidget);

    api.sendGate!.complete();
    api.sendGate = null;
    await pumpUntil(tester, find.text('已记录'));

    expect(find.text('记一下明天买牛奶'), findsOneWidget);
    expect(find.text('1 / 10'), findsOneWidget);
    expect(api.sends, hasLength(1));
    expect(api.sends.single.content, '记一下明天买牛奶');
    expect(api.sends.single.clientMessageId.length, greaterThanOrEqualTo(8));
  });
}
