import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/notifications.dart';
import 'models.dart';

final itemsProvider = AsyncNotifierProvider<ItemsController, List<Item>>(
  ItemsController.new,
);

class ItemsController extends AsyncNotifier<List<Item>> {
  final Set<String> _knownItemIds = {};

  @override
  Future<List<Item>> build() async {
    final items = await ref.read(apiProvider).listItems();
    // 清掉上次会话可能残留的通知，再按当前列表重排。
    await ref.read(notificationServiceProvider).cancelAll();
    _syncNotifications(items);
    return items;
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(() async {
      final items = await ref.read(apiProvider).listItems();
      _syncNotifications(items);
      return items;
    });
  }

  Future<Item> complete(Item item) async {
    final updated = await ref.read(apiProvider).completeItem(item.id);
    _replace(updated);
    await ref.read(notificationServiceProvider).cancel(item.id);
    return updated;
  }

  Future<Item> updateItem(
    Item item, {
    String? title,
    DateTime? dueAt,
    bool clearDueAt = false,
    DateTime? scheduledAt,
    bool clearScheduledAt = false,
  }) async {
    final updated = await ref
        .read(apiProvider)
        .updateItem(
          itemId: item.id,
          title: title,
          dueAt: dueAt,
          clearDueAt: clearDueAt,
          scheduledAt: scheduledAt,
          clearScheduledAt: clearScheduledAt,
        );
    _replace(updated);
    _syncOne(updated);
    return updated;
  }

  Future<void> delete(Item item) async {
    await ref.read(apiProvider).deleteItem(item.id);
    final current = state.value ?? const <Item>[];
    state = AsyncData(
      current.where((candidate) => candidate.id != item.id).toList(),
    );
    _knownItemIds.remove(item.id);
    await ref.read(notificationServiceProvider).cancel(item.id);
  }

  void _replace(Item item) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      current
          .map((candidate) => candidate.id == item.id ? item : candidate)
          .toList(),
    );
  }

  void _syncNotifications(List<Item> items) {
    final currentIds = items.map((item) => item.id).toSet();
    // AI 在对话里删除事项后，刷新结果里不再包含它；这里取消残留的本地通知。
    for (final removedId in _knownItemIds.difference(currentIds)) {
      unawaited(ref.read(notificationServiceProvider).cancel(removedId));
    }
    _knownItemIds
      ..clear()
      ..addAll(currentIds);
    for (final item in items) {
      _syncOne(item);
    }
  }

  void _syncOne(Item item) {
    final service = ref.read(notificationServiceProvider);
    final at = item.notificationAt;
    final shouldSchedule =
        item.status == ItemStatus.open &&
        at != null &&
        at.isAfter(DateTime.now());
    if (shouldSchedule) {
      unawaited(service.schedule(item));
    } else {
      unawaited(service.cancel(item.id));
    }
  }
}
