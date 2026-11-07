import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/models.dart';

void main() {
  test('场景：退出登录 · 清除 token 并取消本机通知', () async {
    var cleared = 0;
    final store = AuthStore(
      MemoryTokenStorage(),
      onSessionCleared: () async {
        cleared++;
      },
    );
    await store.save(
      'token-1',
      const NotaUser(email: 'user@example.com', isVip: false),
    );
    expect(store.isAuthenticated, isTrue);

    await store.clear();

    expect(store.isAuthenticated, isFalse);
    expect(store.token, isNull);
    expect(cleared, 1);
  });
}
