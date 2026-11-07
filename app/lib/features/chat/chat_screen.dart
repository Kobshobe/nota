import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/empty_view.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/quota_badge.dart';
import '../items/models.dart';
import 'chat_controller.dart';
import 'message_bubble.dart';
import 'models.dart';
import 'usage_controller.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final content = _inputController.text;
    if (content.trim().isEmpty || content.length > maxMessageLength) return;
    final ok = await ref
        .read(chatProvider(widget.threadId).notifier)
        .send(content);
    if (!mounted) return;
    if (ok && _inputController.text == content) {
      _inputController.clear();
      setState(() {});
    }
  }

  Future<void> _retry() async {
    final controller = ref.read(chatProvider(widget.threadId).notifier);
    final pending = controller.pendingContent;
    final ok = await controller.retry();
    if (!mounted) return;
    if (ok && _inputController.text == pending) {
      _inputController.clear();
      setState(() {});
    }
  }

  Future<bool> _addAction(
    ChatMessage message,
    int index,
    CandidateAction action,
    ItemKind kind,
  ) async {
    try {
      final item = await ref
          .read(chatProvider(widget.threadId).notifier)
          .addCandidateAction(
            message: message,
            index: index,
            action: action,
            kind: kind,
          );
      if (!mounted) return item != null;
      if (item != null) {
        final suffix = action.dueAt == null ? '' : '，已安排通知';
        AppSnackBar.show(
          context,
          kind == ItemKind.todo ? '已加入待办$suffix' : '已加入提醒$suffix',
        );
      }
      return item != null;
    } on ApiException catch (error) {
      if (mounted) {
        AppSnackBar.show(context, error.userMessage, isError: true);
      }
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider(widget.threadId));
    final usage = ref.watch(usageProvider);
    final state = chat.value;

    ref.listen(chatProvider(widget.threadId), (previous, next) {
      final previousCount = previous?.value?.messages.length ?? 0;
      final nextCount = next.value?.messages.length ?? 0;
      if (nextCount != previousCount) _scrollToBottom();
    });

    final title = state?.thread.title;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title == null || title.isEmpty ? '对话' : title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            if (state != null)
              Text(
                '${state.thread.kind.label}对话',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w400,
                  color: AppColors.muted,
                ),
              ),
          ],
        ),
        actions: [
          if (usage.hasValue)
            QuotaBadge(
              used: usage.requireValue.used,
              limit: usage.requireValue.limit,
              unlimited: usage.requireValue.unlimited,
            )
          else
            QuotaBadge.loading(),
          const SizedBox(width: 12),
        ],
      ),
      body: chat.when(
        loading: () =>
            const Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
        error: (error, stackTrace) => ErrorView(
          message: error is ApiException ? error.userMessage : '加载失败，请重试',
          onRetry: () => ref.invalidate(chatProvider(widget.threadId)),
        ),
        data: (state) => _buildChat(state),
      ),
    );
  }

  Widget _buildChat(ChatState state) {
    final overLimit = _inputController.text.length > maxMessageLength;
    final canSend =
        !state.sending && _inputController.text.trim().isNotEmpty && !overLimit;

    return Column(
      children: [
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 860),
              child: state.messages.isEmpty
                  ? EmptyView(
                      icon: state.thread.kind == ThreadKind.meeting
                          ? Icons.groups_outlined
                          : Icons.edit_note,
                      title: state.thread.kind == ThreadKind.meeting
                          ? '粘贴会议文字'
                          : '说点什么',
                      message: state.thread.kind == ThreadKind.meeting
                          ? '把会议记录贴进来，Nota 会整理摘要、重点和候选事项。'
                          : '例如“提醒我两个小时后去游泳”或“记一下明天买牛奶”。',
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      itemCount: state.messages.length,
                      itemBuilder: (context, index) {
                        final message = state.messages[index];
                        return MessageBubble(
                          message: message,
                          toolCalls:
                              state.toolCallsByMessageId[message.id] ??
                              const [],
                          createdActions: state.createdActions,
                          onAddAction: message.role == MessageRole.assistant
                              ? (action, kind) => _addAction(
                                  message,
                                  _actionIndex(message, action),
                                  action,
                                  kind,
                                )
                              : null,
                        );
                      },
                    ),
            ),
          ),
        ),
        if (state.error != null)
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 860),
              child: _ErrorBanner(
                error: state.error!,
                onRetry: state.error!.retryable ? _retry : null,
                onDismiss: () => ref
                    .read(chatProvider(widget.threadId).notifier)
                    .clearError(),
              ),
            ),
          ),
        if (state.sending)
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 860),
              child: const Padding(
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
            ),
          ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            decoration: const BoxDecoration(
              color: AppColors.paper,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 860),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            key: const ValueKey('chat-input'),
                            controller: _inputController,
                            minLines: 1,
                            maxLines: 5,
                            maxLength: maxMessageLength,
                            maxLengthEnforcement: MaxLengthEnforcement.none,
                            keyboardType: TextInputType.multiline,
                            textInputAction: TextInputAction.newline,
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              hintText: '记下一句话，或粘贴会议文字…',
                              counterText: '',
                            ),
                            buildCounter:
                                (
                                  context, {
                                  required currentLength,
                                  required isFocused,
                                  required maxLength,
                                }) {
                                  return Padding(
                                    padding: const EdgeInsets.only(
                                      top: 5,
                                      left: 4,
                                    ),
                                    child: Text(
                                      '$currentLength / $maxLength',
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: currentLength > maxMessageLength
                                            ? AppColors.danger
                                            : AppColors.muted,
                                      ),
                                    ),
                                  );
                                },
                          ),
                        ),
                        const SizedBox(width: 10),
                        IconButton.filled(
                          key: const ValueKey('chat-send'),
                          onPressed: canSend ? _send : null,
                          tooltip: '发送',
                          icon: state.sending
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.arrow_upward, size: 20),
                        ),
                      ],
                    ),
                    if (overLimit)
                      const Padding(
                        padding: EdgeInsets.only(left: 4, top: 2),
                        child: Text(
                          '单条消息最多 20,000 字，请精简后再发送',
                          style: TextStyle(
                            fontSize: 12,
                            color: AppColors.danger,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  int _actionIndex(ChatMessage message, CandidateAction action) {
    final actions = message.payload?.actions ?? const <CandidateAction>[];
    return actions.indexOf(action);
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.error,
    this.onRetry,
    required this.onDismiss,
  });

  final ApiException error;
  final VoidCallback? onRetry;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 18, color: AppColors.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              error.userMessage,
              style: const TextStyle(fontSize: 13, color: AppColors.danger),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              style: TextButton.styleFrom(foregroundColor: AppColors.danger),
              child: const Text('重试'),
            ),
          IconButton(
            tooltip: '关闭',
            onPressed: onDismiss,
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close, size: 17, color: AppColors.danger),
          ),
        ],
      ),
    );
  }
}
