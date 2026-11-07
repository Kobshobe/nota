import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/features/chat/threads_screen.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：对话列表 · 没有 thread 时显示空状态', (tester) async {
    final api = FakeApi();

    await tester.pumpWidget(testApp(const ThreadsScreen(), api: api));
    await pumpUntil(tester, find.text('还没有对话'));

    expect(find.text('还没有对话'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(find.text('新建会议'), findsWidgets);
  });
}
