import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/chat/timeline.dart';

ChatMessage message(String id, String content, DateTime at) {
  return ChatMessage(
    id: id,
    role: id.startsWith('u') ? MessageRole.user : MessageRole.assistant,
    content: content,
    createdAt: at,
  );
}

ChatMessage deviceNotice(String id, String meetingThreadId, DateTime at) {
  return ChatMessage(
    id: id,
    role: MessageRole.system,
    content: '设备录音已整理成会议：周会',
    createdAt: at,
    payload: MessagePayload(meetingThreadId: meetingThreadId),
  );
}

NotaThread meeting(String id, String title, DateTime at) {
  return NotaThread(
    id: id,
    kind: ThreadKind.meeting,
    title: title,
    createdAt: at,
    updatedAt: at,
  );
}

void main() {
  test('场景：时间线 · 同一时间戳的问答保持原顺序', () {
    // given：20 轮问答，每轮 user 与 assistant 的 createdAt 完全相同
    final base = DateTime.utc(2026, 11, 8, 2);
    final messages = <ChatMessage>[];
    for (var round = 0; round < 20; round++) {
      final at = base.add(Duration(minutes: round));
      messages
        ..add(message('u$round', '问题$round', at))
        ..add(message('a$round', '回答$round', at));
    }

    // when
    final entries = buildTimeline(messages: messages, meetings: const []);

    // then：顺序与输入一致，assistant 不会被排到 user 前面
    expect(
      entries.map((entry) => entry.message!.id).toList(),
      messages.map((item) => item.id).toList(),
    );
  });

  test('场景：时间线 · 会议按创建时间插到消息之间', () {
    final base = DateTime.utc(2026, 11, 8, 2);
    final messages = [
      message('u1', '早上的事', base),
      message('u2', '下午的事', base.add(const Duration(hours: 5))),
    ];
    final meetings = [meeting('m1', '周会', base.add(const Duration(hours: 2)))];

    final entries = buildTimeline(messages: messages, meetings: meetings);

    expect(
      entries.map((entry) => entry.message?.content ?? entry.meeting!.title),
      ['早上的事', '周会', '下午的事'],
    );
  });

  test('场景：时间线 · 会议与消息同一时间时消息在前', () {
    final at = DateTime.utc(2026, 11, 8, 2);
    final entries = buildTimeline(
      messages: [message('u1', '同一分钟', at)],
      meetings: [meeting('m1', '周会', at)],
    );

    expect(entries.first.message?.content, '同一分钟');
    expect(entries.last.meeting?.title, '周会');
  });

  test('场景：时间线 · system 通知不单独占一行', () {
    final at = DateTime.utc(2026, 11, 9, 6);
    final messages = [
      message('u1', '你好', at),
      deviceNotice('s1', 'm1', at),
    ];

    expect(timelineMessages(messages).map((item) => item.id), ['u1']);
    expect(deviceMeetingIds(messages), {'m1'});
  });

  test('场景：时间线 · App 自己录的会议没有被标记成设备录音', () {
    final at = DateTime.utc(2026, 11, 9, 6);
    final messages = [message('u1', '你好', at)];

    expect(deviceMeetingIds(messages), isEmpty);
  });
}
