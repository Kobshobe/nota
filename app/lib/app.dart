import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api.dart';
import 'core/auth_store.dart';
import 'core/notifications.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'features/chat/chat_controller.dart';
import 'features/chat/device_notices.dart';
import 'features/chat/models.dart';
import 'features/chat/threads_controller.dart';
import 'features/items/items_controller.dart';
import 'features/items/models.dart';

class NotaApp extends ConsumerStatefulWidget {
  const NotaApp({super.key});

  @override
  ConsumerState<NotaApp> createState() => _NotaAppState();
}

class _NotaAppState extends ConsumerState<NotaApp> with WidgetsBindingObserver {
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  final Map<String, DateTime> _notifiedDueAt = {};
  Timer? _webReminderTimer;
  Timer? _deviceNoticeTimer;
  String? _seenNoticeId;
  bool _noticeBaseline = false;
  bool _checkingNotices = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (kIsWeb) {
      _webReminderTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _checkWebReminders(),
      );
      WidgetsBinding.instance.addPostFrameCallback((_) => _checkWebReminders());
    }
    // 设备会议在服务端生成，App 没有推送通道：在前台时轮询日常对话里的系统消息。
    _deviceNoticeTimer = Timer.periodic(
      const Duration(seconds: 20),
      (_) => _checkDeviceNotices(),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkDeviceNotices());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _webReminderTimer?.cancel();
    _deviceNoticeTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_checkDeviceNotices());
  }

  Future<void> _checkDeviceNotices() async {
    if (!mounted || _checkingNotices) return;
    if (!ref.read(authStoreProvider).isAuthenticated) {
      _noticeBaseline = false;
      _seenNoticeId = null;
      return;
    }
    _checkingNotices = true;
    try {
      final api = ref.read(apiProvider);
      final threads = await api.listThreads();
      NotaThread? daily;
      for (final thread in threads) {
        if (thread.kind == ThreadKind.daily) {
          daily = thread;
          break;
        }
      }
      if (daily == null) return;
      final detail = await api.getThread(daily.id);
      final latest = latestDeviceNotice(detail.messages);
      // 第一次拿到结果只记基线，历史通知不补弹。
      if (!_noticeBaseline) {
        _noticeBaseline = true;
        _seenNoticeId = latest?.id;
        return;
      }
      if (!isNewDeviceNotice(latest, _seenNoticeId)) return;
      _seenNoticeId = latest!.id;
      await ref
          .read(notificationServiceProvider)
          .show(id: latest.id, title: 'Nota 会议已整理', body: latest.content);
      if (kIsWeb && mounted) {
        _messengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(latest.content)),
        );
      }
      unawaited(ref.read(threadsProvider.notifier).refresh());
      ref.invalidate(chatProvider(daily.id));
    } catch (_) {
      // 轮询失败不打扰用户，下一轮再试。
    } finally {
      _checkingNotices = false;
    }
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
