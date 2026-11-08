import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nota/main.dart' as app;

/// 账号默认走自动注册，不消耗 AI 额度。
const String _email = String.fromEnvironment(
  'SMOKE_EMAIL',
  defaultValue: 'smoke@nota.app',
);

const String _password = String.fromEnvironment(
  'SMOKE_PASSWORD',
  defaultValue: 'nota-smoke-123',
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('场景：登录冒烟 · 真实后端登录后进入对话页', (tester) async {
    // main() 会换掉 ErrorWidget.builder；测试框架在用例结束时校验，必须原地还原。
    final errorBuilder = ErrorWidget.builder;
    try {
      // given：在真机上启动 App
      await app.main();
      final start = await _waitForAny(tester, [
        find.byKey(const ValueKey('login-email')),
        find.text('日常'),
      ]);

      // when：还停在登录页就登录；已有会话（keychain 可用）直接用
      if (start == 0) {
        await tester.enterText(
          find.byKey(const ValueKey('login-email')),
          _email,
        );
        await tester.enterText(
          find.byKey(const ValueKey('login-password')),
          _password,
        );
        await tester.tap(find.byKey(const ValueKey('login-submit')));
      }

      // then：进入对话列表；模拟器没有 keychain 时也必须能进
      await _pumpUntil(
        tester,
        find.text('日常'),
        timeout: const Duration(seconds: 30),
      );
      expect(find.text('日常'), findsWidgets);
    } finally {
      ErrorWidget.builder = errorBuilder;
    }
  });
}

/// 返回第一个出现的目标下标；都没出现就失败。
Future<int> _waitForAny(
  WidgetTester tester,
  List<Finder> finders, {
  Duration timeout = const Duration(seconds: 20),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    for (var index = 0; index < finders.length; index++) {
      if (finders[index].evaluate().isNotEmpty) return index;
    }
  }
  fail('启动后既没有登录页也没有对话列表');
}

Future<void> _pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 15),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('等待 $finder 超时');
}
