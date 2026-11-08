/// 录音转写的服务端状态。
enum RecordingState {
  transcribing,
  completed,
  failed;

  static RecordingState fromWire(String? value) => switch (value) {
    'completed' => RecordingState.completed,
    'failed' => RecordingState.failed,
    _ => RecordingState.transcribing,
  };
}

/// 服务端对一段已上传录音的处理结果。
class Recording {
  const Recording({
    required this.id,
    required this.status,
    this.threadId,
    this.errorCode,
  });

  factory Recording.fromJson(Map<String, dynamic> json) {
    return Recording(
      id: json['id'] as String? ?? '',
      status: RecordingState.fromWire(json['status'] as String?),
      threadId: json['threadId'] as String?,
      errorCode: json['errorCode'] as String?,
    );
  }

  final String id;
  final RecordingState status;

  /// 仅 completed 时存在：转写成功后创建的会议。
  final String? threadId;

  /// 仅 failed 时存在：TRANSCRIPTION_FAILED / QUOTA_EXCEEDED / INTERRUPTED。
  final String? errorCode;
}
