import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../features/auth/models.dart';

abstract class TokenStorage {
  Future<String?> readToken();

  Future<String?> readUser();

  Future<void> writeToken(String token);

  Future<void> writeUser(String userJson);

  Future<void> clear();
}

class SecureTokenStorage implements TokenStorage {
  const SecureTokenStorage([this._storage = const FlutterSecureStorage()]);

  static const _tokenKey = 'nota.token';
  static const _userKey = 'nota.user';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> readToken() => _storage.read(key: _tokenKey);

  @override
  Future<String?> readUser() => _storage.read(key: _userKey);

  @override
  Future<void> writeToken(String token) =>
      _storage.write(key: _tokenKey, value: token);

  @override
  Future<void> writeUser(String userJson) =>
      _storage.write(key: _userKey, value: userJson);

  @override
  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _userKey);
  }
}

class MemoryTokenStorage implements TokenStorage {
  String? _token;
  String? _user;

  @override
  Future<String?> readToken() async => _token;

  @override
  Future<String?> readUser() async => _user;

  @override
  Future<void> writeToken(String token) async => _token = token;

  @override
  Future<void> writeUser(String userJson) async => _user = userJson;

  @override
  Future<void> clear() async {
    _token = null;
    _user = null;
  }
}

class AuthStore extends ChangeNotifier {
  AuthStore(this._storage, {this.onSessionCleared});

  final TokenStorage _storage;
  final Future<void> Function()? onSessionCleared;

  String? _token;
  NotaUser? _user;

  String? get token => _token;
  NotaUser? get user => _user;
  bool get isAuthenticated => _token != null;

  Future<void> restore() async {
    final token = await _storage.readToken();
    if (token == null) return;
    _token = token;
    final userJson = await _storage.readUser();
    if (userJson != null) {
      _user = NotaUser.fromJson(jsonDecode(userJson) as Map<String, dynamic>);
    }
    notifyListeners();
  }

  Future<void> save(String token, NotaUser user) async {
    await _storage.writeToken(token);
    await _storage.writeUser(jsonEncode(user.toJson()));
    _token = token;
    _user = user;
    notifyListeners();
  }

  Future<void> clear() async {
    if (_token == null && _user == null) return;
    _token = null;
    _user = null;
    notifyListeners();
    await _storage.clear();
    await onSessionCleared?.call();
  }
}

final authStoreProvider = Provider<AuthStore>(
  (ref) => throw UnimplementedError('authStoreProvider 必须由入口或测试覆盖'),
);
