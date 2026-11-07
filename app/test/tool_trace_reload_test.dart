import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：对话历史 · 刷新后仍能看到工具轨迹', (tester) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-trace',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final detail = ThreadDetail(
      thread: thread,
      messages: [
        ChatMessage(
          id: 'assistant-trace',
          role: MessageRole.assistant,
          content: '已记下待办',
          payload: const MessagePayload(reply: '已记下待办'),
          toolCalls: [
            ToolCall(
              id: 'trace-1',
              name: ToolName.createItem,
              arguments: const {'title': '买牛奶'},
              result: const {'itemId': 'item-1'},
              createdAt: now,
            ),
            ToolCall(
              id: 'trace-2',
              name: ToolName.finish,
              arguments: const {'reply': '已记下待办'},
              result: const {'committed': true},
              createdAt: now,
            ),
          ],
          createdAt: now,
        ),
      ],
    );
    final api = FakeApi(threads: [thread], detail: detail);

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.text('创建事项'));

    expect(find.text('整理完成'), findsOneWidget);
  });
}
