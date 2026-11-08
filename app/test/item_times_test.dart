import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/notifications.dart';
import 'package:nota/core/theme.dart';
import 'package:nota/features/items/item_card.dart';
import 'package:nota/features/items/items_controller.dart';
import 'package:nota/features/items/models.dart';

import 'test_helpers.dart';

Item item({
  required ItemKind kind,
  DateTime? dueAt,
  DateTime? scheduledAt,
}) {
  final now = DateTime.utc(2026, 11, 8, 2);
  return Item(
    id: 'item-1',
    threadId: 'thread-1',
    kind: kind,
    title: '给张总报价单',
    dueAt: dueAt,
    scheduledAt: scheduledAt,
    status: ItemStatus.open,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  test('通知时刻：提醒用提醒时间，待办用执行时间，截止时间不通知', () {
    final due = DateTime.utc(2026, 11, 13, 15, 59);
    final scheduled = DateTime.utc(2026, 11, 12, 1, 30);

    expect(item(kind: ItemKind.reminder, dueAt: due).notificationAt, due);
    expect(
      item(kind: ItemKind.todo, dueAt: due, scheduledAt: scheduled).notificationAt,
      scheduled,
    );
    expect(item(kind: ItemKind.todo, dueAt: due).notificationAt, isNull);
  });

  test('只清执行时间时，截止时间保持不变', () async {
    final api = FakeApi()
      ..items.add(
        item(
          kind: ItemKind.todo,
          dueAt: DateTime.utc(2026, 11, 13, 15, 59),
          scheduledAt: DateTime.utc(2026, 11, 12, 1, 30),
        ),
      );
    final container = ProviderContainer(
      overrides: [
        apiProvider.overrideWithValue(api),
        notificationServiceProvider.overrideWithValue(FakeNotificationService()),
      ],
    );
    addTearDown(container.dispose);

    final loaded = await container.read(itemsProvider.future);
    final updated = await container
        .read(itemsProvider.notifier)
        .updateItem(loaded.first, clearScheduledAt: true);

    expect(updated.scheduledAt, isNull);
    expect(updated.dueAt, DateTime.utc(2026, 11, 13, 15, 59));
  });

  testWidgets('场景：事项卡片 · 待办同时显示执行时间和截止时间', (tester) async {
    final todo = item(
      kind: ItemKind.todo,
      dueAt: DateTime.utc(2026, 11, 13, 15, 59),
      scheduledAt: DateTime.utc(2026, 11, 12, 1, 30),
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(body: ItemCard(item: todo, onComplete: () {})),
      ),
    );

    expect(find.textContaining('执行 '), findsOneWidget);
    expect(find.textContaining('截止 '), findsOneWidget);
  });

  testWidgets('场景：事项卡片 · 提醒只显示提醒时间', (tester) async {
    final reminder = item(
      kind: ItemKind.reminder,
      dueAt: DateTime.utc(2026, 11, 12, 4),
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(body: ItemCard(item: reminder, onComplete: () {})),
      ),
    );

    expect(find.textContaining('提醒 '), findsOneWidget);
    expect(find.textContaining('截止 '), findsNothing);
  });
}
