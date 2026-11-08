import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

NotaThread _daily() {
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
  testWidgets('场景：输入框 · 发送后收起键盘', (tester) async {
    final thread = _daily();
    final api = FakeApi(
      threads: [thread],
      detail: ThreadDetail(thread: thread, messages: const []),
    );

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    await tester.tap(find.byKey(const ValueKey('chat-input')));
    await tester.pump();
    await tester.enterText(find.byKey(const ValueKey('chat-input')), '你好');
    await tester.pump();
    expect(tester.testTextInput.isVisible, isTrue);

    // when：发送
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await pumpUntil(tester, find.text('已记录'));

    // then：键盘收起
    expect(tester.testTextInput.isVisible, isFalse);
  });

  testWidgets('场景：输入框 · 点空白处收起键盘', (tester) async {
    final thread = _daily();
    final api = FakeApi(
      threads: [thread],
      detail: ThreadDetail(thread: thread, messages: const []),
    );

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    await tester.tap(find.byKey(const ValueKey('chat-input')));
    await tester.pump();
    expect(tester.testTextInput.isVisible, isTrue);

    // when：点消息区的空白
    await tester.tap(find.text('说点什么'));
    await tester.pump();

    // then：键盘收起
    expect(tester.testTextInput.isVisible, isFalse);
  });
}
