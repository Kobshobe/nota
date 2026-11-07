import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/notifications.dart';
import 'package:nota/features/items/items_controller.dart';
import 'package:nota/features/items/models.dart';

import 'test_helpers.dart';

void main() {
  test('场景：事项 · 编辑时清除时间', () async {
    final now = DateTime.now().toUtc();
    final item = Item(
      id: 'item-1',
      threadId: 'thread-1',
      kind: ItemKind.reminder,
      title: '去游泳',
      dueAt: now.add(const Duration(hours: 2)),
      status: ItemStatus.open,
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(items: [item]);
    final container = ProviderContainer(
      overrides: [
        apiProvider.overrideWithValue(api),
        notificationServiceProvider.overrideWithValue(
          FakeNotificationService(),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container.read(itemsProvider.future);
    final updated = await container
        .read(itemsProvider.notifier)
        .updateItem(item, title: item.title, clearDueAt: true);

    expect(api.items.single.dueAt, isNull);
    expect(updated.dueAt, isNull);
  });
}
