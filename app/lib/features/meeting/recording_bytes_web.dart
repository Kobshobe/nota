import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

/// Web 上 `record` 返回的是 `blob:` URL，用 fetch 取回字节再上传。
Future<Uint8List> readRecordingBytes(String pathOrUrl) async {
  final response = await web.window.fetch(pathOrUrl.toJS).toDart;
  if (!response.ok) {
    throw StateError('无法读取录音数据（HTTP ${response.status}）');
  }
  final buffer = await response.arrayBuffer().toDart;
  return buffer.toDart.asUint8List();
}

Future<void> discardRecording(String pathOrUrl) async {
  web.URL.revokeObjectURL(pathOrUrl);
}
