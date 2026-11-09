import '../features/items/models.dart';

/// Web 版不调用通知插件；提醒由页面内的定时检查负责。
class AppNotificationService {
  bool get supported => false;

  Future<void> init() async {}

  Future<void> schedule(Item item) async {}

  Future<void> show({
    required String id,
    required String title,
    required String body,
  }) async {}

  Future<void> cancel(String itemId) async {}

  Future<void> cancelAll() async {}
}
