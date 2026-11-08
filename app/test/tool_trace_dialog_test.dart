import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/chat/tool_trace_fields.dart';
import 'package:nota/shared/format.dart';

import 'test_helpers.dart';

void main() {
  test('场景：工具轨迹 · 参数翻译成中文标签和值', () {
    final fields = describeToolArguments({
      'title': '买牛奶',
      'kind': 'todo',
      'dueAt': '2026-11-08T10:00:00+08:00',
    });

    expect(fields.map((field) => field.label), ['标题', '类型', '截止时间']);
    expect(fields[0].value, '买牛奶');
    expect(fields[1].value, '待办');
    expect(fields[2].value, formatDateTime(DateTime.parse('2026-11-08T10:00:00+08:00')));
  });

  test('场景：工具轨迹 · finish 结果展开 payload，候选逐条编号', () {
    final fields = describeToolResult({
      'finished': true,
      'payload': {
        'reply': '已整理',
        'keyPoints': ['议题一', '议题二'],
        'actions': [
          {'title': '写周报', 'owner': '张三', 'confidence': 0.8},
        ],
      },
    });

    expect(fields.first.label, '回复');
    expect(fields.first.value, '已整理');
    expect(fields.map((field) => field.label), containsAll(['回复', '要点', '候选事项', '1']));
    expect(fields.map((field) => field.value), containsAll(['议题一、议题二', '1 条']));
    expect(fields.last.value, '标题=写周报；负责人=张三；置信度=80%');
  });

  test('场景：工具轨迹 · 嵌套对象不会退化成 Map.toString()', () {
    final fields = describeToolArguments({
      'title': '周会',
      'actions': [
        {
          'title': '写周报',
          'meta': {'owner': '张三'},
        },
      ],
    });

    final summary = fields.last.value;
    expect(summary, contains('meta=负责人=张三'));
    expect(summary, isNot(contains('{')), reason: '界面里不能出现 Dart Map 的花括号');
  });

  test('场景：工具轨迹 · 查询结果列出命中事项', () {
    final fields = describeToolResult({
      'items': [
        {
          'id': 'item-1',
          'threadId': 'thread-1',
          'kind': 'todo',
          'title': '买牛奶',
          'status': 'open',
          'createdAt': '2026-11-08T00:00:00Z',
        },
        {'id': 'item-2', 'title': '交周报'},
      ],
    });

    expect(fields.first.label, '命中');
    expect(fields.first.value, '2 条');
    // id、threadId、createdAt 是噪音，不出现。
    expect(fields[1].value, '类型=待办；标题=买牛奶；状态=未完成');
    expect(fields[2].value, '标题=交周报');
  });

  testWidgets('场景：工具轨迹 · 弹窗用中文字段展示，不显示 JSON', (tester) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-readable',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final detail = ThreadDetail(
      thread: thread,
      messages: [
        ChatMessage(
          id: 'assistant-readable',
          role: MessageRole.assistant,
          content: '已记下待办',
          payload: const MessagePayload(reply: '已记下待办'),
          toolCalls: [
            ToolCall(
              id: 'trace-1',
              name: ToolName.createItem,
              arguments: const {'title': '买牛奶', 'kind': 'todo'},
              result: const {'itemId': 'new_1', 'kind': 'todo'},
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

    await tester.tap(find.text('创建事项'));
    await tester.pumpAndSettle();

    expect(find.text('参数'), findsOneWidget);
    expect(find.text('标题'), findsOneWidget);
    expect(find.text('买牛奶'), findsOneWidget);
    expect(find.text('待办'), findsWidgets);
    expect(find.textContaining('{'), findsNothing);
    expect(find.textContaining('"title"'), findsNothing);
  });
}
