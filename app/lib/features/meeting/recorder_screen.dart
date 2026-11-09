import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../chat/threads_controller.dart';
import '../chat/usage_controller.dart';
import '../chat/models.dart';
import 'models.dart';
import 'recorder.dart';
import 'recording_bytes.dart';

/// 会议录音页：只收音，不写字；结束后上传、转写、进会议。
class MeetingRecorderScreen extends ConsumerStatefulWidget {
  const MeetingRecorderScreen({super.key});

  @override
  ConsumerState<MeetingRecorderScreen> createState() => _MeetingRecorderScreenState();
}

enum _Phase { ready, denied, recording, paused, uploading, transcribing, failed }

class _MeetingRecorderScreenState extends ConsumerState<MeetingRecorderScreen>
    with WidgetsBindingObserver {
  static const Duration maxDuration = Duration(minutes: 8);
  static const Duration _pollInterval = Duration(seconds: 2);

  _Phase _phase = _Phase.ready;
  Duration _elapsed = Duration.zero;
  double _level = 0;
  double _uploadProgress = 0;
  String? _recordingId;
  /// 上传失败时保留本地录音，重试只需要重新上传，不必重录。
  Uint8List? _pendingBytes;
  String? _pendingPath;
  /// 一段录音的上传幂等键：重试复用同一个，成功后才丢弃。
  String? _pendingUploadKey;
  String? _failureCode;
  String? _failureMessage;
  bool _busy = false;
  int _generation = 0;

  Timer? _ticker;
  StreamSubscription<RecordingLevel>? _levelSub;
  static final Random _random = Random();

  /// 一段录音一个键；重传必须复用，服务端靠它识别"同一次上传"。
  String _newUploadKey() {
    return 'r_${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(1 << 20)}';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopTicker();
    _levelSub?.cancel();
    _generation += 1;
    if (_phase == _Phase.recording || _phase == _Phase.paused) {
      unawaited(ref.read(meetingRecorderProvider).cancel());
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // iOS 要的就是锁屏继续录；Web 的标签页被藏起来时只能暂停。
    if (!kIsWeb) return;
    if (state == AppLifecycleState.hidden || state == AppLifecycleState.paused) {
      if (_phase == _Phase.recording) unawaited(_pauseForHiddenTab());
    }
  }

  Future<void> _pauseForHiddenTab() async {
    _stopTicker();
    await ref.read(meetingRecorderProvider).pause();
    if (!mounted) return;
    setState(() => _phase = _Phase.paused);
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _phase != _Phase.recording) return;
      setState(() => _elapsed += const Duration(seconds: 1));
      if (_elapsed >= maxDuration) {
        unawaited(_stopAndProcess());
      }
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  Future<void> _start() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _failureCode = null;
      _failureMessage = null;
    });
    try {
      // 额度用完就别录，免得白录八分钟。
      Usage? usage;
      try {
        usage = await ref.read(usageProvider.future);
      } catch (_) {
        usage = null;
      }
      if (!mounted) return;
      if (usage != null && !usage.unlimited && usage.used >= usage.limit) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'QUOTA_EXCEEDED';
          _failureMessage = '今日额度已用完，明天再录';
        });
        return;
      }

      final recorder = ref.read(meetingRecorderProvider);
      // 权限与启动都可能卡住（模拟器、被占用的麦克风），必须有超时兜底。
      final granted = await recorder
          .hasPermission()
          .timeout(const Duration(seconds: 8), onTimeout: () => false);
      if (!mounted) return;
      if (!granted) {
        setState(() => _phase = _Phase.denied);
        return;
      }
      await recorder.start().timeout(const Duration(seconds: 10));
      if (!mounted) {
        await recorder.cancel();
        return;
      }
      _elapsed = Duration.zero;
      setState(() {
        _phase = _Phase.recording;
        _level = 0;
      });
      _levelSub?.cancel();
      _levelSub = recorder.levels.listen((level) {
        if (mounted && _phase == _Phase.recording) setState(() => _level = level);
      });
      _startTicker();
    } on TimeoutException {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _failureCode = 'INTERNAL';
        _failureMessage = '录音没能启动，请重试';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _failureCode = 'INTERNAL';
        _failureMessage = '没法开始录音，请检查麦克风';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resume() async {
    await ref.read(meetingRecorderProvider).resume();
    if (!mounted) return;
    setState(() => _phase = _Phase.recording);
    _startTicker();
  }

  Future<void> _stopAndProcess() async {
    if (_busy || _phase != _Phase.recording && _phase != _Phase.paused) return;
    setState(() => _busy = true);
    _stopTicker();
    _levelSub?.cancel();
    _levelSub = null;
    final generation = ++_generation;
    try {
      final recorder = ref.read(meetingRecorderProvider);
      final path = await recorder.stop();
      if (!mounted || generation != _generation) return;
      if (path == null) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'TRANSCRIPTION_FAILED';
          _failureMessage = '没有录到声音，重来一次试试';
        });
        return;
      }

      final bytes = await ref.read(recordingBytesProvider)(path);
      if (kDebugMode) debugPrint('[recorder] bytes=${bytes.length}');
      if (bytes.length < 1024) {
        // 浏览器偶尔会给出只有容器头的空录音，直接当「没录到声音」。
        await discardRecording(path);
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'TRANSCRIPTION_FAILED';
          _failureMessage = '没有录到声音，检查麦克风后重试';
        });
        return;
      }
      _pendingPath = path;
      _pendingBytes = bytes;
      _pendingUploadKey ??= _newUploadKey();
      await _uploadAndPoll(generation);
    } on ApiException catch (error) {
      if (mounted && generation == _generation) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = error.code.name.toUpperCase();
          _failureMessage = error.userMessage;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'INTERNAL';
          _failureMessage = '上传失败，请重试';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 上传 + 轮询。失败时保留 `_pendingBytes`，重试只重传不重录。
  Future<void> _uploadAndPoll(int generation) async {
    final bytes = _pendingBytes;
    final idempotencyKey = _pendingUploadKey ??= _newUploadKey();
    if (bytes == null) return;
    setState(() {
      _phase = _Phase.uploading;
      _uploadProgress = 0;
      _failureCode = null;
      _failureMessage = null;
    });
    try {
      final api = ref.read(apiProvider);
      final recording = await api.uploadRecording(
        bytes: bytes,
        filename: kIsWeb ? 'meeting.webm' : 'meeting.m4a',
        duration: _elapsed,
        idempotencyKey: idempotencyKey,
        onProgress: (sent, total) {
          if (mounted && total > 0) {
            setState(() => _uploadProgress = sent / total);
          }
        },
      );
      final path = _pendingPath;
      _pendingPath = null;
      _pendingBytes = null;
      _pendingUploadKey = null;
      if (path != null) unawaited(discardRecording(path));
      if (!mounted || generation != _generation) return;
      setState(() {
        _phase = _Phase.transcribing;
        _recordingId = recording.id;
      });
      await _poll(recording.id, generation);
    } on ApiException catch (error) {
      if (mounted && generation == _generation) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = error.code.name.toUpperCase();
          _failureMessage = error.userMessage;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'INTERNAL';
          _failureMessage = '上传失败，录音还留着，可以重试';
        });
      }
    }
  }

  Future<void> _poll(String recordingId, int generation) async {
    final api = ref.read(apiProvider);
    var networkFailures = 0;
    // 服务端卡住时不能让页面永远停在「整理中」。
    final deadline = DateTime.now().add(const Duration(minutes: 10));
    while (mounted && generation == _generation) {
      if (DateTime.now().isAfter(deadline)) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = 'TRANSCRIPTION_FAILED';
          _failureMessage = '整理超时，可以重试';
        });
        return;
      }
      Recording recording;
      try {
        recording = await api.getRecording(recordingId);
        networkFailures = 0;
      } on ApiException catch (error) {
        if (error.code != ApiErrorCode.network && error.code != ApiErrorCode.timeout) {
          rethrow;
        }
        networkFailures += 1;
        if (networkFailures >= 5) {
          throw const ApiException(
            code: ApiErrorCode.network,
            message: 'poll failed',
            retryable: true,
          );
        }
        await Future<void>.delayed(_pollInterval);
        continue;
      }

      if (!mounted || generation != _generation) return;
      if (recording.status == RecordingState.completed) {
        unawaited(ref.read(threadsProvider.notifier).refresh());
        final threadId = recording.threadId;
        if (threadId != null) {
          context.pushReplacement('/chat/$threadId');
        }
        return;
      }
      if (recording.status == RecordingState.failed) {
        setState(() {
          _phase = _Phase.failed;
          _failureCode = recording.errorCode;
          _failureMessage = _failureMessageFor(recording.errorCode);
        });
        return;
      }
      await Future<void>.delayed(_pollInterval);
    }
  }

  Future<void> _retry() async {
    if (_busy) return;
    final recordingId = _recordingId;
    if (recordingId == null) {
      if (_pendingBytes == null) {
        await _reset();
        return;
      }
      setState(() => _busy = true);
      try {
        await _uploadAndPoll(_generation);
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).retryRecording(recordingId);
      if (!mounted) return;
      setState(() {
        _phase = _Phase.transcribing;
        _failureCode = null;
        _failureMessage = null;
      });
      final generation = _generation;
      await _poll(recordingId, generation);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _failureCode = error.code.name.toUpperCase();
        _failureMessage = error.userMessage;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final recorder = ref.read(meetingRecorderProvider);
    await recorder.cancel();
    final path = _pendingPath;
    _pendingPath = null;
    _pendingBytes = null;
    if (path != null) unawaited(discardRecording(path));
    _levelSub?.cancel();
    _levelSub = null;
    _stopTicker();
    if (!mounted) return;
    setState(() {
      _phase = _Phase.ready;
      _elapsed = Duration.zero;
      _level = 0;
      _uploadProgress = 0;
      _recordingId = null;
      _failureCode = null;
      _failureMessage = null;
    });
  }

  Future<bool> _confirmLeave() async {
    if (_phase != _Phase.recording && _phase != _Phase.paused) return true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('放弃这段录音？'),
        content: const Text('录音还没有结束，离开后这段内容不会保存。'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('继续录')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('放弃')),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _leave() async {
    if (await _confirmLeave()) {
      if (!mounted) return;
      await ref.read(meetingRecorderProvider).cancel();
      if (mounted) context.pop();
    }
  }

  String? _failureMessageFor(String? errorCode) => switch (errorCode) {
    'QUOTA_EXCEEDED' => '今日额度已用完，录音保留 24 小时',
    'INTERRUPTED' => '服务重启打断了这次整理，可以重试',
    _ => '转写失败，录音保留 24 小时，可以重试',
  };

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _phase != _Phase.recording && _phase != _Phase.paused,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final confirmed = await _confirmLeave();
        if (!confirmed) return;
        await ref.read(meetingRecorderProvider).cancel();
        if (!context.mounted) return;
        context.pop();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            tooltip: '返回',
            icon: const Icon(Icons.arrow_back),
            onPressed: _leave,
          ),
          titleSpacing: 0,
          title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('新会议', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              Text(
                '录音转纪要',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400, color: AppColors.muted),
              ),
            ],
          ),
        ),
        body: SafeArea(
          top: false,
          child: Column(
            children: [
              Expanded(child: _buildBody()),
              if (_phase == _Phase.ready || _phase == _Phase.denied)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                  child: TextButton(
                    key: const ValueKey('recording-paste-text'),
                    onPressed: () => context.push('/meeting/new'),
                    child: const Text('或者粘贴文字'),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    return switch (_phase) {
      _Phase.ready => _panel(
        icon: Icons.mic_none,
        title: '开始录音',
        message: '最长 8 分钟，结束后自动整理成摘要、重点和候选待办。',
        action: FilledButton.icon(
          key: const ValueKey('recording-start'),
          onPressed: _busy ? null : _start,
          icon: const Icon(Icons.mic),
          label: const Text('开始录音'),
        ),
      ),
      _Phase.denied => _panel(
        icon: Icons.mic_off_outlined,
        title: '没有麦克风权限',
        message: '到系统设置里允许 Nota 使用麦克风，或者改用粘贴文字。',
        action: FilledButton(
          key: const ValueKey('recording-permission-retry'),
          onPressed: _start,
          child: const Text('重新申请'),
        ),
      ),
      _Phase.recording => _recordingView(),
      _Phase.paused => _panel(
        icon: Icons.pause_circle_outline,
        title: '已暂停',
        message: '页面回到前台后可以继续录这一段。',
        action: FilledButton.icon(
          key: const ValueKey('recording-resume'),
          onPressed: _resume,
          icon: const Icon(Icons.mic),
          label: const Text('继续录音'),
        ),
      ),
      _Phase.uploading => _progressView(
        label: '上传中 ${(_uploadProgress * 100).round()}%',
        value: _uploadProgress,
      ),
      _Phase.transcribing => _transcribingView(),
      _Phase.failed => _failedView(),
    };
  }

  Widget _recordingView() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: const BoxDecoration(color: AppColors.danger, shape: BoxShape.circle),
            ),
            const SizedBox(height: 12),
            const Text('录音中', style: TextStyle(fontSize: 13, color: AppColors.muted)),
            const SizedBox(height: 8),
            Text(
              _formatDuration(_elapsed),
              key: const ValueKey('recording-timer'),
              style: const TextStyle(
                fontSize: 44,
                fontWeight: FontWeight.w300,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: 220,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: _level,
                  minHeight: 6,
                  backgroundColor: AppColors.border,
                ),
              ),
            ),
            const SizedBox(height: 32),
            FilledButton.icon(
              key: const ValueKey('recording-stop'),
              onPressed: _stopAndProcess,
              icon: const Icon(Icons.stop),
              label: const Text('结束并整理'),
            ),
            const SizedBox(height: 12),
            Text(
              kIsWeb ? '离开这个标签页会暂停录音' : '锁屏或切到别的 App 也会继续录',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _transcribingView() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(width: 32, height: 32, child: CircularProgressIndicator(strokeWidth: 2.5)),
            const SizedBox(height: 24),
            const Text(
              '整理中…',
              key: ValueKey('recording-status'),
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            const Text(
              '转写和纪要都在服务端进行，可以离开，整理好后会出现在主对话。',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _progressView({required String label, required double value}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            LinearProgressIndicator(value: value, minHeight: 6),
            const SizedBox(height: 20),
            Text(label, key: const ValueKey('recording-status'), style: const TextStyle(fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _failedView() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 32, color: AppColors.danger),
            const SizedBox(height: 16),
            Text(
              _failureMessage ?? '出了点问题',
              key: const ValueKey('recording-error'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 24),
            if ((_recordingId != null || _pendingBytes != null) &&
                _failureCode != 'QUOTA_EXCEEDED')
              FilledButton(
                key: const ValueKey('recording-retry'),
                onPressed: _busy ? null : _retry,
                child: const Text('重试'),
              ),
            const SizedBox(height: 8),
            TextButton(
              key: const ValueKey('recording-restart'),
              onPressed: _busy ? null : _reset,
              child: const Text('重新录一段'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _panel({
    required IconData icon,
    required String title,
    required String message,
    required Widget action,
  }) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 36, color: AppColors.muted),
            const SizedBox(height: 20),
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: AppColors.muted, height: 1.6),
            ),
            const SizedBox(height: 28),
            action,
          ],
        ),
      ),
    );
  }
}

String _formatDuration(Duration duration) {
  final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
  final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$minutes:$seconds';
}
