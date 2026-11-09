import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/message_bubble.dart';
import 'package:nota/features/chat/models.dart';

ChatMessage _notice({String? meetingThreadId}) {
  return ChatMessage(
    id: 'system-1',
    role: MessageRole.system,
    content: '设备录音已整理成会议：首页改版定稿',
    createdAt: DateTime.utc(2026, 11, 9, 5, 30),
    payload: meetingThreadId == null
        ? null
        : MessagePayload(meetingThreadId: meetingThreadId),
  );
}

void main() {
  testWidgets('系统消息显示通知文本和查看会议入口', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MessageBubble(message: _notice(meetingThreadId: 'thread-1')),
        ),
      ),
    );

    expect(find.text('设备录音已整理成会议：首页改版定稿'), findsOneWidget);
    expect(find.text('查看会议'), findsOneWidget);
  });

  testWidgets('没有会议引用时只显示通知文本', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: MessageBubble(message: _notice())),
      ),
    );

    expect(find.text('设备录音已整理成会议：首页改版定稿'), findsOneWidget);
    expect(find.text('查看会议'), findsNothing);
  });

  test('role 和 meetingThreadId 能从契约字段解析', () {
    final message = ChatMessage.fromJson({
      'id': 'm1',
      'role': 'system',
      'content': '设备录音已整理成会议：周会',
      'payload': {'meetingThreadId': 't1'},
      'createdAt': '2026-11-09T05:30:00.000Z',
    });

    expect(message.role, MessageRole.system);
    expect(message.payload?.meetingThreadId, 't1');
  });
}
