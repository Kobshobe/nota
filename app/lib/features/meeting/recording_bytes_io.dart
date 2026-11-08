import 'dart:io';
import 'dart:typed_data';

Future<Uint8List> readRecordingBytes(String pathOrUrl) {
  return File(pathOrUrl).readAsBytes();
}

Future<void> discardRecording(String pathOrUrl) async {
  final file = File(pathOrUrl);
  if (await file.exists()) {
    await file.delete();
  }
}
