import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/features/auth/login_screen.dart';

import 'test_helpers.dart';

void main() {
  testWidgets('场景：登录 · 密码错误时停留在登录页并提示', (tester) async {
    final api = FakeApi()
      ..loginError = const ApiException(
        code: ApiErrorCode.invalidCredentials,
        message: 'Invalid credentials',
        statusCode: 401,
      );

    await tester.pumpWidget(testApp(const LoginScreen(), api: api));
    await tester.pump();

    await tester.enterText(
      find.byKey(const ValueKey('login-email')),
      ' User@Example.com ',
    );
    await tester.enterText(
      find.byKey(const ValueKey('login-password')),
      'wrongpass',
    );
    await tester.tap(find.byKey(const ValueKey('login-submit')));

    await pumpUntil(tester, find.text('邮箱或密码不正确'));

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(api.loginCalls, 1);
    expect(api.lastLoginEmail, 'user@example.com');
  });
}
