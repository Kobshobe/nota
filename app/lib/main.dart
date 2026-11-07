import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/auth_store.dart';
import 'core/notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final notifications = AppNotificationService();
  await notifications.init();
  final authStore = AuthStore(
    const SecureTokenStorage(),
    onSessionCleared: notifications.cancelAll,
  );
  await authStore.restore();
  runApp(
    ProviderScope(
      overrides: [
        authStoreProvider.overrideWithValue(authStore),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
      child: const NotaApp(),
    ),
  );
}
