import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/auth_store.dart';
import 'core/notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  ErrorWidget.builder = (details) => const Material(
    color: Color(0xFFF6F0E4),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Nota 界面加载失败，请刷新后重试。',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF2D2A24),
              fontSize: 15,
              height: 1.6,
            ),
          ),
        ),
      ),
    ),
  );

  final notifications = AppNotificationService();
  final authStore = AuthStore(
    const SecureTokenStorage(),
    onSessionCleared: notifications.cancelAll,
  );

  try {
    await authStore.restore();
  } catch (error) {
    debugPrint('restore session failed: $error');
    try {
      await authStore.clear();
    } catch (_) {}
  }

  runApp(
    ProviderScope(
      overrides: [
        authStoreProvider.overrideWithValue(authStore),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
      child: const NotaApp(),
    ),
  );

  // 权限弹窗不能挡在首帧之前，否则 iOS 启动会先显示空白底。
  unawaited(_initNotifications(notifications));
}

Future<void> _initNotifications(AppNotificationService notifications) async {
  try {
    await notifications.init();
  } catch (error) {
    debugPrint('notification init failed: $error');
  }
}
