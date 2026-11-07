import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import 'models.dart';

final threadsProvider =
    AsyncNotifierProvider<ThreadsController, List<NotaThread>>(
      ThreadsController.new,
    );

class ThreadsController extends AsyncNotifier<List<NotaThread>> {
  @override
  Future<List<NotaThread>> build() async {
    final threads = await ref.read(apiProvider).listThreads();
    threads.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return threads;
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(() async {
      final threads = await ref.read(apiProvider).listThreads();
      threads.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      return threads;
    });
  }

  Future<NotaThread> createMeeting({String? title}) async {
    final thread = await ref.read(apiProvider).createThread(title: title);
    final current = state.value ?? const <NotaThread>[];
    state = AsyncData([thread, ...current]);
    return thread;
  }
}
