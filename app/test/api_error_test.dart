import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/features/auth/models.dart';

class _FixedAdapter implements HttpClientAdapter {
  _FixedAdapter(this.status, this.body);

  final int status;
  final Map<String, dynamic> body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
        if (status == 429) 'retry-after': ['120'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(int status, Map<String, dynamic> body, AuthStore store) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test'));
  dio.httpClientAdapter = _FixedAdapter(status, body);
  return ApiClient(authStore: store, dio: dio);
}

void main() {
  test('场景：额度 · 429 映射 retryAfter 与固定重置时间', () async {
    final store = AuthStore(MemoryTokenStorage());
    await store.save(
      'token',
      const NotaUser(email: 'user@example.com', isVip: false),
    );
    final api = _client(429, {
      'code': 'QUOTA_EXCEEDED',
      'message': 'Daily quota exhausted',
      'requestId': 'req_1',
    }, store);

    await expectLater(
      api.getUsage(),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', ApiErrorCode.quotaExceeded)
            .having(
              (e) => e.retryAfter,
              'retryAfter',
              const Duration(seconds: 120),
            )
            .having((e) => e.quotaResetAt, 'quotaResetAt', isNotNull),
      ),
    );
  });

  test('场景：登录过期 · 401 清空 token', () async {
    final store = AuthStore(MemoryTokenStorage());
    await store.save(
      'token',
      const NotaUser(email: 'user@example.com', isVip: false),
    );
    final api = _client(401, {
      'code': 'UNAUTHORIZED',
      'message': 'Authentication required',
      'requestId': 'req_2',
    }, store);

    await expectLater(
      api.me(),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ApiErrorCode.unauthorized,
        ),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(store.isAuthenticated, isFalse);
  });
}
