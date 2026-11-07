import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../chat/threads_screen.dart';
import '../items/items_controller.dart';
import '../items/items_screen.dart';
import '../items/models.dart';

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;
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
    if (!mounted) return;
    final items = ref.read(itemsProvider).value;
    if (items == null) return;
    final now = DateTime.now();
    for (final item in items) {
      if (item.status != ItemStatus.open) continue;
      final dueAt = item.dueAt;
      if (dueAt == null || dueAt.isAfter(now)) continue;
      if (_notifiedDueAt[item.id] == dueAt) continue;
      _notifiedDueAt[item.id] = dueAt;
      AppSnackBar.show(context, '提醒：${item.title}');
      break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [ThreadsScreen(), ItemsScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: '对话',
          ),
          NavigationDestination(
            icon: Icon(Icons.checklist_outlined),
            selectedIcon: Icon(Icons.checklist),
            label: '事项',
          ),
        ],
      ),
      backgroundColor: AppColors.paper,
    );
  }
}
