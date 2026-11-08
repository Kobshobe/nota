import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// 录音期间的音量，0（静音）到 1（很响）。
typedef RecordingLevel = double;

/// 录音能力的抽象：页面对它编程，测试里换成假的实现。
abstract class MeetingRecorder {
  Future<bool> hasPermission();

  Future<void> start();

  Future<void> pause();

  Future<void> resume();

  /// 返回本机录音路径；Web 上是一个 `blob:` URL。
  Future<String?> stop();

  Future<void> cancel();

  Stream<RecordingLevel> get levels;

  Future<void> dispose();
}

class DeviceMeetingRecorder implements MeetingRecorder {
  DeviceMeetingRecorder({AudioRecorder? recorder}) : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<void> start() async {
    final path = await _newRecordingPath();
    await _recorder.start(
      // 浏览器只稳定支持 webm/opus；iOS 直接录 m4a。
      RecordConfig(
        // 44.1 kHz / 96 kbps 与 enjournal 里验证过可用的配置一致；
        // 模拟器对 16 kHz 输入不买账时会录出空文件。
        encoder: kIsWeb ? AudioEncoder.opus : AudioEncoder.aacLc,
        sampleRate: kIsWeb ? 48000 : 44100,
        bitRate: kIsWeb ? 64000 : 96000,
        numChannels: 1,
      ),
      path: path,
    );
  }

  Future<String> _newRecordingPath() async {
    final extension = kIsWeb ? 'webm' : 'm4a';
    final name = 'meeting-${DateTime.now().millisecondsSinceEpoch}.$extension';
    if (kIsWeb) return name;
    final dir = await getTemporaryDirectory();
    return '${dir.path}/$name';
  }

  @override
  Future<void> pause() => _recorder.pause();

  @override
  Future<void> resume() => _recorder.resume();

  @override
  Future<String?> stop() => _recorder.stop();

  @override
  Future<void> cancel() => _recorder.cancel();

  @override
  Stream<RecordingLevel> get levels => _recorder
      .onAmplitudeChanged(const Duration(milliseconds: 200))
      .map((amplitude) => normalizeAmplitude(amplitude.current));

  @override
  Future<void> dispose() => _recorder.dispose();
}

/// dBFS（-60..0）换算成 0..1，低于 -60 视为静音。
double normalizeAmplitude(double db) => ((db + 60) / 60).clamp(0.0, 1.0);

final meetingRecorderProvider = Provider<MeetingRecorder>((ref) {
  final recorder = DeviceMeetingRecorder();
  ref.onDispose(recorder.dispose);
  return recorder;
});
