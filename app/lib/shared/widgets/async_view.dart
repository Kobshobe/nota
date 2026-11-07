import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import 'error_view.dart';

class AsyncView<T> extends StatelessWidget {
  const AsyncView({
    super.key,
    required this.value,
    required this.data,
    this.onRetry,
    this.loading,
    this.isEmpty,
    this.empty,
  });

  final AsyncValue<T> value;
  final Widget Function(T value) data;
  final VoidCallback? onRetry;
  final Widget? loading;
  final bool Function(T value)? isEmpty;
  final Widget? empty;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (value) {
        if (isEmpty?.call(value) == true && empty != null) {
          return empty!;
        }
        return data(value);
      },
      loading: () =>
          loading ??
          const Center(
            child: Padding(
              padding: EdgeInsets.all(48),
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
          ),
      error: (error, stackTrace) => ErrorView(
        message: error is ApiException ? error.userMessage : '加载失败，请重试',
        onRetry: onRetry,
      ),
    );
  }
}
