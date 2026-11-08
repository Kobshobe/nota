import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/models.dart';

class BrokenTokenStorage implements TokenStorage {
  @override
  Future<String?> readToken() async => throw Exception('keychain unavailable');

  @override
  Future<String?> readUser() async => throw Exception('keychain unavailable');

  @override
  Future<void> writeToken(String token) async =>
      throw Exception('ErrSecMissingEntitlement -34018');

  @override
  Future<void> writeUser(String userJson) async =>
      throw Exception('ErrSecMissingEntitlement -34018');

  @override
  Future<void> clear() async => throw Exception('ErrSecMissingEntitlement -34018');
}

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

  test('场景：登录 · 安全存储不可用时仍然登录，只是不持久化', () async {
    final store = AuthStore(BrokenTokenStorage());

    // when：Keychain 拒绝写入（未签名的模拟器包）
    await store.save(
      'token-1',
      const NotaUser(email: 'user@example.com', isVip: false),
    );

    // then：本次会话可用，重启后需要重新登录
    expect(store.isAuthenticated, isTrue);
    expect(store.token, 'token-1');
    expect(store.user?.email, 'user@example.com');
  });

  test('场景：退出登录 · 存储层报错也不影响本地会话清理', () async {
    final store = AuthStore(BrokenTokenStorage());
    await store.save(
      'token-1',
      const NotaUser(email: 'user@example.com', isVip: false),
    );

    await store.clear();

    expect(store.isAuthenticated, isFalse);
    expect(store.token, isNull);
  });
}
