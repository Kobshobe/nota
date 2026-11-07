import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'notifications_stub.dart' if (dart.library.io) 'notifications_io.dart';

export 'notifications_stub.dart' if (dart.library.io) 'notifications_io.dart';

final notificationServiceProvider = Provider<AppNotificationService>(
  (ref) => AppNotificationService(),
);
