import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import 'models.dart';

final usageProvider = AsyncNotifierProvider<UsageController, Usage>(
  UsageController.new,
);

class UsageController extends AsyncNotifier<Usage> {
  @override
  Future<Usage> build() async {
    return ref.read(apiProvider).getUsage();
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(() => ref.read(apiProvider).getUsage());
  }

  void setUsage(Usage usage) {
    state = AsyncData(usage);
  }
}
