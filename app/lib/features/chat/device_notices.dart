import 'models.dart';

/// 日常对话里最后一条系统通知（设备会议整理完成）；没有就返回 null。
ChatMessage? latestDeviceNotice(List<ChatMessage> messages) {
  for (final message in messages.reversed) {
    if (message.role == MessageRole.system) return message;
  }
  return null;
}

/// 和上次看到的是同一条时不重复通知。
bool isNewDeviceNotice(ChatMessage? latest, String? seenId) {
  return latest != null && latest.id != seenId;
}
