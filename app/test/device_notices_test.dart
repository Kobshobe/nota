import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/device_notices.dart';
import 'package:nota/features/chat/models.dart';

ChatMessage _message(String id, MessageRole role) {
  return ChatMessage(
    id: id,
    role: role,
    content: '内容 $id',
    createdAt: DateTime.utc(2026, 11, 9, 6),
  );
}

void main() {
  test('取最后一条系统消息，忽略普通消息', () {
    final messages = [
      _message('u1', MessageRole.user),
      _message('a1', MessageRole.assistant),
      _message('s1', MessageRole.system),
      _message('a2', MessageRole.assistant),
    ];

    expect(latestDeviceNotice(messages)?.id, 's1');
  });

  test('没有系统消息时返回 null', () {
    expect(latestDeviceNotice([_message('u1', MessageRole.user)]), isNull);
  });

  test('只在消息 id 变化时算新通知', () {
    final notice = _message('s1', MessageRole.system);

    expect(isNewDeviceNotice(notice, null), isTrue);
    expect(isNewDeviceNotice(notice, 's0'), isTrue);
    expect(isNewDeviceNotice(notice, 's1'), isFalse);
    expect(isNewDeviceNotice(null, 's1'), isFalse);
  });
}
