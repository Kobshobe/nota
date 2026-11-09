import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../features/items/models.dart';

/// iOS 本地通知。dueAt 是 UTC，排期时换算到 Asia/Shanghai：
/// 绝对时刻不变，产品展示与额度日界都按这个时区。
class AppNotificationService {
  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  Future<void>? _initialized;

  bool get supported => true;

  Future<void> init() => _initialized ??= _init();

  Future<void> _init() async {
    tz_data.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Shanghai'));
    await _plugin.initialize(
      settings: const InitializationSettings(
        iOS: DarwinInitializationSettings(
          requestAlertPermission: true,
          requestBadgePermission: true,
          requestSoundPermission: true,
        ),
      ),
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin
        >()
        ?.requestPermissions(alert: true, badge: true, sound: true);
  }

  Future<void> schedule(Item item) async {
    final dueAt = item.notificationAt;
    if (dueAt == null || item.status != ItemStatus.open) {
      await cancel(item.id);
      return;
    }
    await init();
    final when = tz.TZDateTime.from(
      dueAt.toUtc(),
      tz.getLocation('Asia/Shanghai'),
    );
    if (!when.isAfter(tz.TZDateTime.now(tz.getLocation('Asia/Shanghai')))) {
      return;
    }
    await _plugin.zonedSchedule(
      id: _notificationId(item.id),
      title: 'Nota 提醒',
      body: item.title,
      scheduledDate: when,
      notificationDetails: const NotificationDetails(
        iOS: DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      payload: item.id,
    );
  }

  /// 立即弹一条本地通知（设备会议整理完成这类服务端事件）。
  Future<void> show({
    required String id,
    required String title,
    required String body,
  }) async {
    await init();
    await _plugin.show(
      id: _notificationId(id),
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        iOS: DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: id,
    );
  }

  Future<void> cancel(String itemId) async {
    final initialized = _initialized;
    if (initialized == null) return;
    await initialized;
    await _plugin.cancel(id: _notificationId(itemId));
  }

  Future<void> cancelAll() async {
    final initialized = _initialized;
    if (initialized == null) return;
    await initialized;
    await _plugin.cancelAll();
  }

  int _notificationId(String itemId) => itemId.hashCode & 0x7fffffff;
}
