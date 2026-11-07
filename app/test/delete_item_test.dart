import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/items/items_screen.dart';
import 'package:nota/features/items/models.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：事项 · 删除后从未完成列表消失', (tester) async {
    final now = DateTime.now().toUtc();
    final openItem = Item(
      id: 'item-1',
      threadId: 'thread-1',
      kind: ItemKind.todo,
      title: '交周报',
      dueAt: now.add(const Duration(days: 1)),
      status: ItemStatus.open,
      createdAt: now,
      updatedAt: now,
    );
    final doneItem = Item(
      id: 'item-2',
      threadId: 'thread-1',
      kind: ItemKind.todo,
      title: '买牛奶',
      status: ItemStatus.done,
      createdAt: now,
      updatedAt: now,
    );
    final api = FakeApi(items: [openItem, doneItem]);
    final notifications = FakeNotificationService();

    await tester.pumpWidget(
      testApp(const ItemsScreen(), api: api, notifications: notifications),
    );
    await pumpUntil(tester, find.text('交周报'));

    await tester.tap(find.byIcon(Icons.more_horiz).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '删除'));

    await pumpUntil(tester, find.text('已删除'));
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('交周报'), findsNothing);
    expect(api.deletedIds, contains('item-1'));
    expect(notifications.cancelled, contains('item-1'));

    await tester.pump(const Duration(seconds: 5));
  });
}
