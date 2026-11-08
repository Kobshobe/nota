import 'models.dart';

/// 主对话时间线里的一项：一条消息，或一场已创建的会议。
class TimelineEntry {
  const TimelineEntry.message(this.message) : meeting = null;
  const TimelineEntry.meeting(this.meeting) : message = null;

  final ChatMessage? message;
  final NotaThread? meeting;
}

/// 消息保持服务端顺序，会议按创建时间插到对应位置。
///
/// 合并结果不做整体排序：同一次请求里 user 与 assistant 的 createdAt 完全相同，
/// 不稳定排序会把问答顺序打乱。
List<TimelineEntry> buildTimeline({
  required List<ChatMessage> messages,
  required List<NotaThread> meetings,
}) {
  final ordered = [...meetings]
    ..sort((a, b) {
      final byTime = a.createdAt.compareTo(b.createdAt);
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });
  final entries = <TimelineEntry>[];
  var messageIndex = 0;
  var meetingIndex = 0;
  while (messageIndex < messages.length || meetingIndex < ordered.length) {
    final message = messageIndex < messages.length
        ? messages[messageIndex]
        : null;
    final meeting = meetingIndex < ordered.length
        ? ordered[meetingIndex]
        : null;
    if (message != null &&
        (meeting == null || !message.createdAt.isAfter(meeting.createdAt))) {
      entries.add(TimelineEntry.message(message));
      messageIndex++;
    } else if (meeting != null) {
      entries.add(TimelineEntry.meeting(meeting));
      meetingIndex++;
    }
  }
  return entries;
}
