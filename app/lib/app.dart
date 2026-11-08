import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth_store.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'features/items/items_controller.dart';
import 'features/items/models.dart';

class NotaApp extends ConsumerStatefulWidget {
  const NotaApp({super.key});

  @override
  ConsumerState<NotaApp> createState() => _NotaAppState();
}

class _NotaAppState extends ConsumerState<NotaApp> {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  final Map<String, DateTime> _notifiedDueAt = {};
  Timer? _webReminderTimer;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) {
      _webReminderTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _checkWebReminders(),
      );
      WidgetsBinding.instance.addPostFrameCallback((_) => _checkWebReminders());
    }
  }

  @override
  void dispose() {
    _webReminderTimer?.cancel();
    super.dispose();
  }

  void _checkWebReminders() {
    if (!mounted || !ref.read(authStoreProvider).isAuthenticated) return;
    final items = ref.read(itemsProvider).value;
    if (items == null) return;
    final now = DateTime.now();
    for (final item in items) {
      if (item.status != ItemStatus.open) continue;
      final dueAt = item.dueAt;
      if (dueAt == null || dueAt.isAfter(now)) continue;
      if (_notifiedDueAt[item.id] == dueAt) continue;
      _notifiedDueAt[item.id] = dueAt;
      _messengerKey.currentState?.showSnackBar(
        SnackBar(content: Text('提醒：${item.title}')),
      );
      break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Nota',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: const Locale('zh', 'CN'),
      supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      scaffoldMessengerKey: _messengerKey,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
