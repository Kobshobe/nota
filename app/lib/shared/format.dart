import 'package:intl/intl.dart';

String formatDueAt(DateTime? value) {
  if (value == null) return '无时间';
  final local = value.toLocal();
  final now = DateTime.now();
  final day = DateTime(local.year, local.month, local.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = day.difference(today).inDays;
  final time = DateFormat('HH:mm').format(local);
  if (diff == 0) return '今天 $time';
  if (diff == 1) return '明天 $time';
  if (diff == -1) return '昨天 $time';
  if (local.year == now.year) {
    return DateFormat('M月d日 HH:mm').format(local);
  }
  return DateFormat('yyyy年M月d日 HH:mm').format(local);
}

String formatDateTime(DateTime value) {
  return DateFormat('yyyy年M月d日 HH:mm').format(value.toLocal());
}

String formatThreadTime(DateTime value) {
  final local = value.toLocal();
  final now = DateTime.now();
  final day = DateTime(local.year, local.month, local.day);
  final today = DateTime(now.year, now.month, now.day);
  final diff = day.difference(today).inDays;
  if (diff == 0) return DateFormat('HH:mm').format(local);
  if (diff == -1) return '昨天';
  if (local.year == now.year) return DateFormat('M月d日').format(local);
  return DateFormat('yyyy/M/d').format(local);
}

String formatMessageTime(DateTime value) {
  return DateFormat('HH:mm').format(value.toLocal());
}

bool isOverdue(DateTime? dueAt) {
  return dueAt != null && dueAt.isBefore(DateTime.now());
}
