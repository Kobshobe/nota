import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../shared/widgets/empty_view.dart';
import '../chat/chat_composer.dart';
import '../chat/chat_controller.dart';
import '../chat/models.dart';
import '../chat/threads_controller.dart';
import '../chat/usage_controller.dart';
import '../items/items_controller.dart';

/// 空白会议页：先输入，第一条消息发出时才真正创建会议。
class NewMeetingScreen extends ConsumerStatefulWidget {
  const NewMeetingScreen({super.key});

  @override
  ConsumerState<NewMeetingScreen> createState() => _NewMeetingScreenState();
}

class _NewMeetingScreenState extends ConsumerState<NewMeetingScreen> {
  final _input = TextEditingController();
  final _random = Random();
  bool _sending = false;
  ApiException? _error;

  /// 会议创建成功后复用，重试不会重复建会。
  String? _threadId;
  String? _pendingContent;
  String? _pendingClientMessageId;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final content = _input.text.trim();
    if (content.isEmpty || content.length > maxMessageLength || _sending) {
      return;
    }

    // await 之后组件可能已经销毁，先把依赖取出来。
    final api = ref.read(apiProvider);
    final threads = ref.read(threadsProvider.notifier);
    final items = ref.read(itemsProvider.notifier);
    final usageNotifier = ref.read(usageProvider.notifier);

    final reuseId =
        _pendingClientMessageId != null && _pendingContent == content;
    final clientMessageId = reuseId
        ? _pendingClientMessageId!
        : 'm-${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 20)}';
    _pendingContent = content;
    _pendingClientMessageId = clientMessageId;

    // 先清空，失败再还原，和主对话保持一致。
    _input.clear();
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      // 额度用完就别先建会议，免得留下一条空会议；拉不到额度就交给服务端判断。
      Usage? usage;
      try {
        usage = await ref.read(usageProvider.future);
      } catch (_) {
        usage = null;
      }
      if (!mounted) return;
      if (usage != null && !usage.unlimited && usage.used >= usage.limit) {
        setState(
          () => _error = const ApiException(
            code: ApiErrorCode.quotaExceeded,
            message: 'Daily quota exhausted',
          ),
        );
        return;
      }

      var threadId = _threadId;
      if (threadId == null) {
        final thread = await api.createThread();
        if (!mounted) return;
        _threadId = thread.id;
        threadId = thread.id;
      }
      final result = await api.sendMessage(
        threadId: threadId,
        content: content,
        clientMessageId: clientMessageId,
      );
      usageNotifier.setUsage(result.usage);
      unawaited(threads.refresh());
      unawaited(items.refresh());
      if (!mounted) return;
      context.pushReplacement('/chat/$threadId');
    } on ApiException catch (error) {
      if (mounted) {
        if (_input.text.isEmpty) _input.text = content;
        setState(() => _error = error);
      }
    } catch (_) {
      if (mounted) {
        if (_input.text.isEmpty) _input.text = content;
        setState(
          () => _error = const ApiException(
            code: ApiErrorCode.unknown,
            message: 'send failed',
            retryable: true,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: '返回',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        titleSpacing: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '新会议',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            Text(
              '会议对话',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w400,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      ),
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
        child: Column(
          children: [
            const Expanded(
              child: EmptyView(
                icon: Icons.groups_outlined,
                title: '粘贴会议文字',
                message: '把会议记录贴进来，Nota 会整理摘要、重点和候选事项。',
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text(
                  _error!.userMessage,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.danger,
                  ),
                ),
              ),
            if (_sending)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 8),
                    Text(
                      '整理中…',
                      style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
            ChatComposer(controller: _input, sending: _sending, onSend: _send),
          ],
        ),
      ),
    );
  }
}
