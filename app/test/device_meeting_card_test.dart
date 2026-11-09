import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/chat_screen.dart';
import 'package:nota/features/chat/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：日常对话 · 设备会议只显示一张带标识的卡片', (tester) async {
    final now = DateTime.utc(2026, 11, 9, 6);
    final daily = NotaThread(
      id: 'd1',
      kind: ThreadKind.daily,
      title: '日常',
      createdAt: now,
      updatedAt: now,
    );
    final meeting = NotaThread(
      id: 'm1',
      kind: ThreadKind.meeting,
      title: '首页改版定稿',
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(
      threads: [daily, meeting],
      detail: ThreadDetail(
        thread: daily,
        messages: [
          ChatMessage(
            id: 'u1',
            role: MessageRole.user,
            content: '记一下',
            createdAt: now,
          ),
          ChatMessage(
            id: 's1',
            role: MessageRole.system,
            content: '设备录音已整理成会议：首页改版定稿',
            createdAt: now,
            payload: const MessagePayload(meetingThreadId: 'm1'),
          ),
        ],
      ),
    );

    await tester.pumpWidget(testApp(ChatScreen(threadId: daily.id), api: api));
    await pumpUntil(tester, find.byKey(const ValueKey('meeting-card-m1')));

    // 只有一张会议卡片，system 通知不单独占一行。
    expect(find.text('设备录音'), findsOneWidget);
    expect(find.text('首页改版定稿'), findsOneWidget);
    expect(find.text('设备录音已整理成会议：首页改版定稿'), findsNothing);
  });
}
