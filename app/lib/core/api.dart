import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../features/auth/models.dart';
import '../features/chat/models.dart';
import '../features/items/models.dart';
import '../features/meeting/models.dart';
import 'auth_store.dart';

const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://127.0.0.1:8080',
);

enum ApiErrorCode {
  invalidInput,
  invalidCredentials,
  unauthorized,
  notFound,
  quotaExceeded,
  transcriptionFailed,
  internal,
  network,
  timeout,
  unknown;

  static ApiErrorCode fromWire(String? value) => switch (value) {
    'INVALID_INPUT' => ApiErrorCode.invalidInput,
    'INVALID_CREDENTIALS' => ApiErrorCode.invalidCredentials,
    'UNAUTHORIZED' => ApiErrorCode.unauthorized,
    'NOT_FOUND' => ApiErrorCode.notFound,
    'QUOTA_EXCEEDED' => ApiErrorCode.quotaExceeded,
    'TRANSCRIPTION_FAILED' => ApiErrorCode.transcriptionFailed,
    'INTERNAL' => ApiErrorCode.internal,
    _ => ApiErrorCode.unknown,
  };
}

class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.statusCode,
    this.requestId,
    this.retryable = false,
    this.retryAfter,
    this.quotaResetAt,
    this.displayMessage,
  });

  final ApiErrorCode code;
  final String message;
  final int? statusCode;
  final String? requestId;
  final bool retryable;
  final Duration? retryAfter;
  final DateTime? quotaResetAt;

  /// 客户端本地错误可以给出比 code 默认文案更具体的说明。
  final String? displayMessage;

  String get userMessage =>
      displayMessage ??
      switch (code) {
        ApiErrorCode.invalidInput => '输入有误，请检查后重试',
        ApiErrorCode.invalidCredentials => '邮箱或密码不正确',
        ApiErrorCode.unauthorized => '登录已过期，请重新登录',
        ApiErrorCode.notFound => '内容不存在或已被删除',
        ApiErrorCode.quotaExceeded => _quotaMessage,
        ApiErrorCode.transcriptionFailed => '录音转写失败，请重试',
        ApiErrorCode.internal => '服务暂时不可用，请稍后重试',
        ApiErrorCode.network => '网络连接失败，请检查网络后重试',
        ApiErrorCode.timeout => '请求超时，请稍后重试',
        ApiErrorCode.unknown => '出了点问题，请稍后重试',
      };

  String get _quotaMessage {
    final resetAt =
        quotaResetAt ??
        (retryAfter == null ? null : DateTime.now().add(retryAfter!));
    if (resetAt == null) return '今日额度已用完';
    return '今日额度已用完，将于 ${DateFormat('HH:mm').format(resetAt)} 重置';
  }

  @override
  String toString() =>
      'ApiException(${code.name}, status: $statusCode, message: $message)';
}

class AuthInterceptor extends Interceptor {
  AuthInterceptor(this._authStore);

  final AuthStore _authStore;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = _authStore.token;
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}

class ErrorInterceptor extends Interceptor {
  ErrorInterceptor(this._authStore);

  final AuthStore _authStore;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiError = _classify(err);
    if (apiError.code == ApiErrorCode.unauthorized) {
      unawaited(_authStore.clear());
    }
    handler.reject(err.copyWith(error: apiError));
  }

  ApiException _classify(DioException error) {
    final response = error.response;
    final status = response?.statusCode;
    final data = response?.data;
    final requestId =
        (data is Map ? data['requestId']?.toString() : null) ??
        response?.headers.value('x-request-id');

    if (data is Map) {
      final code = ApiErrorCode.fromWire(data['code']?.toString());
      final retryAfter = _retryAfter(response);
      return ApiException(
        code: code,
        message: data['message']?.toString() ?? error.message ?? '',
        statusCode: status,
        requestId: requestId,
        retryable:
            code == ApiErrorCode.internal || (status != null && status >= 500),
        retryAfter: retryAfter,
        quotaResetAt: retryAfter == null
            ? null
            : DateTime.now().add(retryAfter),
      );
    }

    if (status == 401) {
      return ApiException(
        code: ApiErrorCode.unauthorized,
        message: error.message ?? 'Unauthorized',
        statusCode: status,
        requestId: requestId,
      );
    }
    if (status == 429) {
      final retryAfter = _retryAfter(response);
      return ApiException(
        code: ApiErrorCode.quotaExceeded,
        message: error.message ?? 'Quota exceeded',
        statusCode: status,
        requestId: requestId,
        retryAfter: retryAfter,
        quotaResetAt: retryAfter == null
            ? null
            : DateTime.now().add(retryAfter),
      );
    }
    if (status != null && status >= 500) {
      return ApiException(
        code: ApiErrorCode.internal,
        message: error.message ?? 'Server error',
        statusCode: status,
        requestId: requestId,
        retryable: true,
      );
    }
    if (status == 400) {
      return ApiException(
        code: ApiErrorCode.invalidInput,
        message: error.message ?? 'Invalid input',
        statusCode: status,
        requestId: requestId,
      );
    }
    if (status == 404) {
      return ApiException(
        code: ApiErrorCode.notFound,
        message: error.message ?? 'Not found',
        statusCode: status,
        requestId: requestId,
      );
    }

    return switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout => ApiException(
        code: ApiErrorCode.timeout,
        message: error.message ?? 'Timeout',
        retryable: true,
      ),
      DioExceptionType.connectionError => ApiException(
        code: ApiErrorCode.network,
        message: error.message ?? 'Network error',
        retryable: true,
      ),
      _ => ApiException(
        code: ApiErrorCode.network,
        message: error.message ?? 'Network error',
        retryable: true,
      ),
    };
  }

  Duration? _retryAfter(Response<dynamic>? response) {
    final raw = response?.headers.value('retry-after');
    final seconds = raw == null ? null : int.tryParse(raw);
    return seconds == null ? null : Duration(seconds: seconds);
  }
}

class _LoggingInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kDebugMode) {
      debugPrint('[api] ${options.method} ${options.path}');
    }
    handler.next(options);
  }

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    if (kDebugMode) {
      debugPrint(
        '[api] ${response.statusCode} ${response.requestOptions.path}',
      );
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (kDebugMode) {
      debugPrint(
        '[api] error ${err.response?.statusCode ?? '-'} ${err.requestOptions.path}',
      );
    }
    handler.next(err);
  }
}

abstract class NotaApi {
  Future<AuthResult> login({required String email, required String password});

  Future<NotaUser> me();

  Future<List<NotaThread>> listThreads();

  Future<NotaThread> createThread({String? title});

  Future<ThreadDetail> getThread(String threadId);

  Future<SendMessageResult> sendMessage({
    required String threadId,
    required String content,
    required String clientMessageId,
  });

  Future<List<Item>> listItems({ItemStatus? status, String? threadId});

  Future<Item> createItem({
    required String threadId,
    required ItemKind kind,
    required String title,
    DateTime? dueAt,
    DateTime? scheduledAt,
    String? sourceMessageId,
    int? candidateIndex,
  });

  Future<Item> updateItem({
    required String itemId,
    String? title,
    DateTime? dueAt,
    bool clearDueAt = false,
    DateTime? scheduledAt,
    bool clearScheduledAt = false,
  });

  Future<Item> completeItem(String itemId);

  Future<void> deleteItem(String itemId);

  Future<Usage> getUsage();

  Future<Recording> uploadRecording({
    required List<int> bytes,
    required String filename,
    required Duration duration,
    void Function(int sent, int total)? onProgress,
  });

  Future<Recording> getRecording(String recordingId);

  Future<Recording> retryRecording(String recordingId);
}

class ApiClient implements NotaApi {
  ApiClient({required AuthStore authStore, Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: apiBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 180),
              sendTimeout: const Duration(seconds: 30),
              contentType: Headers.jsonContentType,
              responseType: ResponseType.json,
            ),
          ) {
    _dio.interceptors.addAll([
      AuthInterceptor(authStore),
      ErrorInterceptor(authStore),
      _LoggingInterceptor(),
    ]);
  }

  final Dio _dio;

  @override
  Future<AuthResult> login({required String email, required String password}) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/auth/login',
        data: {'email': email, 'password': password},
      ),
      (data) => AuthResult.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<NotaUser> me() {
    return _request(
      () => _dio.get<dynamic>('/api/auth/me'),
      (data) => NotaUser.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<List<NotaThread>> listThreads() {
    return _request(
      () => _dio.get<dynamic>('/api/threads'),
      (data) => (data['threads'] as List<dynamic>)
          .map((entry) => NotaThread.fromJson(entry as Map<String, dynamic>))
          .toList(),
    );
  }

  @override
  Future<NotaThread> createThread({String? title}) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/threads',
        data: {
          'kind': 'meeting',
          if (title != null && title.isNotEmpty) 'title': title,
        },
      ),
      (data) => NotaThread.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<ThreadDetail> getThread(String threadId) {
    return _request(
      () => _dio.get<dynamic>('/api/threads/$threadId'),
      (data) => ThreadDetail.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<SendMessageResult> sendMessage({
    required String threadId,
    required String content,
    required String clientMessageId,
  }) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/threads/$threadId/messages',
        data: {'content': content, 'clientMessageId': clientMessageId},
      ),
      (data) => SendMessageResult.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<List<Item>> listItems({ItemStatus? status, String? threadId}) {
    return _request(
      () => _dio.get<dynamic>(
        '/api/items',
        queryParameters: {
          'limit': 100,
          if (status != null) 'status': status.wire,
          'threadId': ?threadId,
        },
      ),
      (data) => (data['items'] as List<dynamic>)
          .map((entry) => Item.fromJson(entry as Map<String, dynamic>))
          .toList(),
    );
  }

  @override
  Future<Item> createItem({
    required String threadId,
    required ItemKind kind,
    required String title,
    DateTime? dueAt,
    DateTime? scheduledAt,
    String? sourceMessageId,
    int? candidateIndex,
  }) {
    final body = <String, dynamic>{
      'threadId': threadId,
      'kind': kind.wire,
      'title': title,
    };
    if (dueAt != null) {
      body['dueAt'] = dueAt.toUtc().toIso8601String();
    }
    if (scheduledAt != null) {
      body['scheduledAt'] = scheduledAt.toUtc().toIso8601String();
    }
    if (sourceMessageId != null) body['sourceMessageId'] = sourceMessageId;
    if (candidateIndex != null) body['candidateIndex'] = candidateIndex;
    return _request(
      () => _dio.post<dynamic>('/api/items', data: body),
      (data) => Item.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<Item> updateItem({
    required String itemId,
    String? title,
    DateTime? dueAt,
    bool clearDueAt = false,
    DateTime? scheduledAt,
    bool clearScheduledAt = false,
  }) {
    final body = <String, dynamic>{};
    if (title != null) body['title'] = title;
    if (clearDueAt) {
      body['dueAt'] = null;
    } else if (dueAt != null) {
      body['dueAt'] = dueAt.toUtc().toIso8601String();
    }
    if (clearScheduledAt) {
      body['scheduledAt'] = null;
    } else if (scheduledAt != null) {
      body['scheduledAt'] = scheduledAt.toUtc().toIso8601String();
    }
    return _request(
      () => _dio.patch<dynamic>('/api/items/$itemId', data: body),
      (data) => Item.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<Item> completeItem(String itemId) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/items/$itemId/complete',
        // 空 body 配 application/json 会被 Fastify 判成 400。
        data: const <String, dynamic>{},
      ),
      (data) => Item.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<void> deleteItem(String itemId) {
    return _request<void>(
      () => _dio.delete<dynamic>(
        '/api/items/$itemId',
        data: const <String, dynamic>{},
      ),
      (_) {},
    );
  }

  @override
  Future<Usage> getUsage() {
    return _request(
      () => _dio.get<dynamic>('/api/usage'),
      (data) => Usage.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<Recording> uploadRecording({
    required List<int> bytes,
    required String filename,
    required Duration duration,
    void Function(int sent, int total)? onProgress,
  }) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/recordings',
        data: FormData.fromMap({
          'durationMs': duration.inMilliseconds.toString(),
          'audio': MultipartFile.fromBytes(bytes, filename: filename),
        }),
        onSendProgress: onProgress,
      ),
      (data) => Recording.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<Recording> getRecording(String recordingId) {
    return _request(
      () => _dio.get<dynamic>('/api/recordings/$recordingId'),
      (data) => Recording.fromJson(data as Map<String, dynamic>),
    );
  }

  @override
  Future<Recording> retryRecording(String recordingId) {
    return _request(
      () => _dio.post<dynamic>(
        '/api/recordings/$recordingId/retry',
        // 空 body 配 application/json 会被 Fastify 判成 400，显式给一个对象。
        data: const <String, dynamic>{},
      ),
      (data) => Recording.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<T> _request<T>(
    Future<Response<dynamic>> Function() send,
    T Function(dynamic data) parse,
  ) async {
    try {
      final response = await send();
      return parse(response.data);
    } on DioException catch (error) {
      final mapped = error.error;
      if (mapped is ApiException) throw mapped;
      throw ApiException(
        code: ApiErrorCode.network,
        message: error.message ?? 'Network error',
        retryable: true,
      );
    } on ApiException {
      rethrow;
    } catch (error) {
      throw ApiException(
        code: ApiErrorCode.unknown,
        message: 'Invalid response: $error',
        retryable: true,
      );
    }
  }
}

final apiProvider = Provider<NotaApi>((ref) {
  return ApiClient(authStore: ref.watch(authStoreProvider));
});
