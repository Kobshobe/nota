import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/models.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/profile/profile_screen.dart';

import 'test_helpers.dart';

Future<Widget> _profileApp(FakeApi api) async {
  final store = AuthStore(MemoryTokenStorage());
  await store.save('token-1', const NotaUser(email: 'demo@nota.com', isVip: false));
  return testRoutedApp(
    api: api,
    authStore: store,
    initialLocation: '/profile',
    routes: [GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen())],
  );
}

void main() {
  testWidgets('场景：额度 · 我的页面点检测误扣费，弹出最近一条可疑记录', (tester) async {
    final api = FakeApi()..chargeCheck = const ChargeCheck(
        state: 'released',
        message: '最近一次整理没有计费，额度已经退回。',
      );

    await tester.pumpWidget(await _profileApp(api));
    await pumpUntil(tester, find.byKey(const ValueKey('profile-check-charge')));

    await tester.tap(find.byKey(const ValueKey('profile-check-charge')));
    await tester.pumpAndSettle();

    expect(api.chargeCheckCalls, 1);
    expect(find.text('误扣费检测'), findsOneWidget);
    expect(find.text('最近一次整理没有计费，额度已经退回。'), findsOneWidget);
  });

  testWidgets('场景：额度 · 没有可疑记录时也给出明确回答', (tester) async {
    final api = FakeApi();

    await tester.pumpWidget(await _profileApp(api));
    await pumpUntil(tester, find.byKey(const ValueKey('profile-check-charge')));

    await tester.tap(find.byKey(const ValueKey('profile-check-charge')));
    await tester.pumpAndSettle();

    expect(find.text('没有发现可疑的扣费记录，最近的整理都正常计费。'), findsOneWidget);
  });
}
