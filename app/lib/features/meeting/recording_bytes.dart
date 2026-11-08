import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'recording_bytes_io.dart'
    if (dart.library.js_interop) 'recording_bytes_web.dart' as platform;

/// 读出录好的音频字节：iOS 上是本地文件，Web 上是 `blob:` URL。
typedef RecordingBytesReader = Future<Uint8List> Function(String pathOrUrl);

Future<Uint8List> readRecordingBytes(String pathOrUrl) =>
    platform.readRecordingBytes(pathOrUrl);

/// 读完就删，避免临时录音堆积。
Future<void> discardRecording(String pathOrUrl) => platform.discardRecording(pathOrUrl);

/// 测试里替换成假字节，避免碰真实文件或网络。
final recordingBytesProvider = Provider<RecordingBytesReader>((_) => readRecordingBytes);
