import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/core/notifications.dart';
import 'package:nota/features/items/items_controller.dart';
import 'package:nota/features/items/models.dart';

import 'test_helpers.dart';

void main() {
  test('场景：事项 · 刷新时取消已消失事项的本地通知', () async {
    final now = DateTime.now().toUtc();
    final item = Item(
      id: 'item-1',
      threadId: 'thread-1',
      kind: ItemKind.reminder,
      title: '开会',
      dueAt: now.add(const Duration(hours: 1)),
      status: ItemStatus.open,
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(items: [item]);
    final notifications = FakeNotificationService();
    final container = ProviderContainer(
      overrides: [
        apiProvider.overrideWithValue(api),
        authStoreProvider.overrideWithValue(AuthStore(MemoryTokenStorage())),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
    );
    addTearDown(container.dispose);

    await container.read(itemsProvider.future);
    expect(
      notifications.scheduled.map((entry) => entry.id),
      contains('item-1'),
    );

    api.items.removeWhere((entry) => entry.id == 'item-1');
    await container.read(itemsProvider.notifier).refresh();

    expect(notifications.cancelled, contains('item-1'));
  });
}
