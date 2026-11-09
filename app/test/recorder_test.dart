import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/core/notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/meeting/models.dart';
import 'package:nota/features/meeting/recorder.dart';
import 'package:nota/features/meeting/recorder_screen.dart';
import 'package:nota/features/meeting/recording_bytes.dart';

import 'test_helpers.dart';

Widget recorderApp({
  required FakeApi api,
  required FakeRecorder recorder,
  FakeNotificationService? notifications,
}) {
  final container = ProviderContainer(
    overrides: [
      apiProvider.overrideWithValue(api),
      authStoreProvider.overrideWithValue(AuthStore(MemoryTokenStorage())),
      notificationServiceProvider.overrideWithValue(
        notifications ?? FakeNotificationService(),
      ),
      meetingRecorderProvider.overrideWithValue(recorder),
      recordingBytesProvider.overrideWithValue(
        (_) async => Uint8List(2048),
      ),
    ],
  );
  addTearDown(container.dispose);
  return testRoutedApp(
    api: api,
    initialLocation: '/meeting/record',
    container: container,
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const Scaffold(body: Text('首页')),
      ),
      GoRoute(
        path: '/meeting/record',
        builder: (context, state) => const MeetingRecorderScreen(),
      ),
      GoRoute(
        path: '/meeting/new',
        builder: (context, state) => const Scaffold(body: Text('粘贴文字页')),
      ),
      GoRoute(
        path: '/chat/:threadId',
        builder: (context, state) =>
            Scaffold(body: Text('会议页 ${state.pathParameters['threadId']}')),
      ),
    ],
  );
}

FakeApi apiWithMeeting() {
  final now = DateTime.now().toUtc();
  final meeting = NotaThread(
    id: 'thread-meeting',
    kind: ThreadKind.meeting,
    title: '产品周会',
    createdAt: now,
    updatedAt: now,
  );
  return FakeApi(threads: [meeting]);
}

void main() {
  testWidgets('场景：会议录音 · 没有麦克风权限时给粘贴文字兜底', (tester) async {
    final api = apiWithMeeting();
    final recorder = FakeRecorder(permission: false);

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));

    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.text('没有麦克风权限'));

    expect(recorder.startCalls, 0);
    expect(find.byKey(const ValueKey('recording-paste-text')), findsOneWidget);
  });

  testWidgets('场景：会议录音 · 结束录音后上传并进入会议', (tester) async {
    final api = apiWithMeeting();
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));

    // when：开始录音
    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.text('录音中'));
    expect(recorder.startCalls, 1);

    // then：计时按秒走
    await tester.pump(const Duration(seconds: 1));
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('recording-timer'))).data,
      '00:01',
    );

    // when：结束并整理
    await tester.tap(find.byKey(const ValueKey('recording-stop')));
    await tester.pump();
    await pumpUntil(tester, find.textContaining('会议页'));

    // then：音频只上传一次，时长为录音时长
    expect(api.uploadCalls, 1);
    expect(api.lastUploadBytes?.length, 2048);
    expect(api.lastUploadDuration, const Duration(seconds: 1));
  });

  testWidgets('场景：会议录音 · 转写失败可以重试', (tester) async {
    final api = apiWithMeeting()
      ..pollQueue.add(
        const Recording(
          id: 'rec-1',
          status: RecordingState.failed,
          errorCode: 'TRANSCRIPTION_FAILED',
        ),
      );
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));
    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-stop')));
    await tester.tap(find.byKey(const ValueKey('recording-stop')));

    await pumpUntil(tester, find.byKey(const ValueKey('recording-error')));
    expect(find.textContaining('转写失败'), findsOneWidget);

    // when：点重试
    api.pollQueue.add(
      const Recording(
        id: 'rec-1',
        status: RecordingState.completed,
        threadId: 'thread-meeting',
      ),
    );
    await tester.tap(find.byKey(const ValueKey('recording-retry')));
    await pumpUntil(tester, find.textContaining('会议页'));

    // then：走的是服务端重试，不重新上传音频
    expect(api.retryCalls, 1);
    expect(api.uploadCalls, 1);
  });

  testWidgets('场景：会议录音 · 上传失败后重试只重传不重录', (tester) async {
    final api = apiWithMeeting()..failUploadTimes = 1;
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));
    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-stop')));
    await tester.tap(find.byKey(const ValueKey('recording-stop')));

    // then：上传失败，录音还留着，可以直接重试
    await pumpUntil(tester, find.byKey(const ValueKey('recording-retry')));
    expect(recorder.stopCalls, 1);

    await tester.tap(find.byKey(const ValueKey('recording-retry')));
    await pumpUntil(tester, find.textContaining('会议页'));

    // then：重新上传，但没有再次录音
    expect(api.uploadCalls, 2);
    expect(recorder.stopCalls, 1);

    // then：两次上传复用同一个幂等键，服务端只会建一条录音、只扣一次
    expect(api.uploadKeys, hasLength(2));
    expect(api.uploadKeys.first, api.uploadKeys.last);
  });

  testWidgets('场景：会议录音 · 满 8 分钟自动结束', (tester) async {
    final api = apiWithMeeting();
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));
    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.text('录音中'));

    // when：时间走到上限
    await tester.pump(const Duration(minutes: 8));
    await tester.pump();

    // then：自动停止并开始整理
    expect(recorder.stopCalls, 1);
    expect(api.uploadCalls, 1);
  });

  testWidgets('场景：会议录音 · 额度用完不开始录音', (tester) async {
    final api = apiWithMeeting();
    api.usage = Usage(
      used: 10,
      limit: 10,
      unlimited: false,
      date: '2026-11-08',
      resetsAt: DateTime.utc(2026, 11, 9),
    );
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-start')));
    await tester.tap(find.byKey(const ValueKey('recording-start')));
    await pumpUntil(tester, find.textContaining('今日额度已用完'));

    expect(recorder.startCalls, 0);
  });

  testWidgets('场景：会议录音 · 粘贴文字入口仍然可达', (tester) async {
    final api = apiWithMeeting();
    final recorder = FakeRecorder();

    await tester.pumpWidget(recorderApp(api: api, recorder: recorder));
    await pumpUntil(tester, find.byKey(const ValueKey('recording-paste-text')));

    await tester.tap(find.byKey(const ValueKey('recording-paste-text')));
    await pumpUntil(tester, find.text('粘贴文字页'));
  });
}
