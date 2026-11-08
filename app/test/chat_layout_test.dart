import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：聊天页 · 键盘弹起且输入多行时不溢出', (tester) async {
    // given：小屏 + 高键盘（中文输入法常见高度）
    tester.view.physicalSize = const Size(375 * 3, 667 * 3);
    tester.view.devicePixelRatio = 3;
    tester.view.viewInsets = const FakeViewPadding(bottom: 380 * 3);
    addTearDown(tester.view.reset);

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

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));

    // when：输入六行内容
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '第一行\n第二行\n第三行\n第四行\n第五行\n第六行',
    );
    await tester.pump();

    // then：不出现 RenderFlex 溢出
    expect(tester.takeException(), isNull);
  });

  testWidgets('场景：聊天页 · 有历史消息时键盘弹起也不溢出', (tester) async {
    tester.view.physicalSize = const Size(375 * 3, 667 * 3);
    tester.view.devicePixelRatio = 3;
    tester.view.viewInsets = const FakeViewPadding(bottom: 380 * 3);
    addTearDown(tester.view.reset);

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
      detail: ThreadDetail(
        thread: thread,
        messages: [
          ChatMessage(
            id: 'm1',
            role: MessageRole.user,
            content: '记一下明天买牛奶',
            createdAt: now,
          ),
          ChatMessage(
            id: 'm2',
            role: MessageRole.assistant,
            content: '已记录。',
            createdAt: now,
          ),
        ],
      ),
    );

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('chat-input')));
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      '第一行\n第二行\n第三行\n第四行\n第五行',
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
  });
}
