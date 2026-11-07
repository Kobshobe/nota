import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/auth_store.dart';
import '../chat/chat_controller.dart';
import '../chat/threads_controller.dart';
import '../chat/usage_controller.dart';
import '../items/items_controller.dart';

final loginControllerProvider =
    AsyncNotifierProvider.autoDispose<LoginController, void>(
      LoginController.new,
    );

class LoginController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {}

  Future<bool> login({required String email, required String password}) async {
    state = const AsyncLoading();
    try {
      final result = await ref
          .read(apiProvider)
          .login(email: email, password: password);
      ref.invalidate(chatProvider);
      ref.invalidate(threadsProvider);
      ref.invalidate(itemsProvider);
      ref.invalidate(usageProvider);
      await ref.read(authStoreProvider).save(result.token, result.user);
      state = const AsyncData(null);
      return true;
    } catch (error, stackTrace) {
      final apiError = error is ApiException
          ? error
          : ApiException(
              code: ApiErrorCode.unknown,
              message: '$error',
              retryable: true,
            );
      state = AsyncError(apiError, stackTrace);
      return false;
    }
  }
}
