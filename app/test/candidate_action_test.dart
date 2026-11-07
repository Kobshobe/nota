import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/items/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：会议纪要 · 点选候选待办后创建事项', (tester) async {
    final now = DateTime.now().toUtc();
    final dueAt = now.add(const Duration(days: 1));
    final thread = NotaThread(
      id: 'thread-1',
      kind: ThreadKind.meeting,
      title: '周一产品同步',
      createdAt: now,
      updatedAt: now,
    );
    final action = CandidateAction(
      title: '准备周报',
      owner: '我',
      dueAt: dueAt,
      evidence: '周五前发我',
    );
    final detail = ThreadDetail(
      thread: thread,
      messages: [
        ChatMessage(
          id: 'assistant-1',
          role: MessageRole.assistant,
          content: '已整理这场会议',
          payload: MessagePayload(summary: '同步了本周进度。', actions: [action]),
          createdAt: now,
        ),
      ],
    );
    final api = FakeApi(threads: [thread], detail: detail);
    final notifications = FakeNotificationService();

    await tester.pumpWidget(
      testApp(
        ChatScreen(threadId: thread.id),
        api: api,
        notifications: notifications,
      ),
    );
    await pumpUntil(tester, find.text('准备周报'));

    await tester.tap(find.text('加入待办'));
    await pumpUntil(tester, find.text('已加入事项'));
    await tester.pump();

    expect(api.createItemCalls, hasLength(1));
    expect(api.createItemCalls.single.threadId, thread.id);
    expect(api.createItemCalls.single.kind, ItemKind.todo);
    expect(api.createItemCalls.single.title, '准备周报');
    expect(api.createItemCalls.single.dueAt, dueAt);
    expect(api.createItemCalls.single.sourceMessageId, 'assistant-1');
    expect(api.createItemCalls.single.candidateIndex, 0);
    expect(find.textContaining('已加入待办'), findsOneWidget);

    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('场景：会议纪要 · 无时间的候选事项只提供加入待办', (tester) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-2',
      kind: ThreadKind.meeting,
      title: '无时间事项',
      createdAt: now,
      updatedAt: now,
    );
    final detail = ThreadDetail(
      thread: thread,
      messages: [
        ChatMessage(
          id: 'assistant-2',
          role: MessageRole.assistant,
          content: '已整理这场会议',
          payload: const MessagePayload(
            summary: '有一条没有时间的候选事项。',
            actions: [CandidateAction(title: '整理会议结论')],
          ),
          createdAt: now,
        ),
      ],
    );
    final api = FakeApi(threads: [thread], detail: detail);

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.text('整理会议结论'));

    expect(find.text('加入待办'), findsOneWidget);
    expect(find.text('加入提醒'), findsNothing);

    await tester.tap(find.text('加入待办'));
    await pumpUntil(tester, find.text('已加入事项'));

    expect(api.createItemCalls, hasLength(1));
    expect(api.createItemCalls.single.kind, ItemKind.todo);
    expect(api.createItemCalls.single.dueAt, isNull);

    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('场景：会议纪要 · 重新打开时已确认的候选显示已加入', (tester) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-3',
      kind: ThreadKind.meeting,
      title: '已确认候选',
      createdAt: now,
      updatedAt: now,
    );
    final detail = ThreadDetail(
      thread: thread,
      messages: [
        ChatMessage(
          id: 'assistant-3',
          role: MessageRole.assistant,
          content: '已整理这场会议',
          payload: const MessagePayload(
            actions: [CandidateAction(title: '准备周报')],
          ),
          createdAt: now,
        ),
      ],
    );
    final existing = Item(
      id: 'item-existing',
      threadId: thread.id,
      kind: ItemKind.todo,
      title: '准备周报',
      sourceMessageId: 'assistant-3',
      candidateIndex: 0,
      status: ItemStatus.open,
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(threads: [thread], detail: detail, items: [existing]);

    await tester.pumpWidget(testApp(ChatScreen(threadId: thread.id), api: api));
    await pumpUntil(tester, find.text('已加入事项'));

    expect(find.text('加入待办'), findsNothing);
    expect(find.text('加入提醒'), findsNothing);
  });
}
