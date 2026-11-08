import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/empty_view.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/format.dart';
import '../items/models.dart';
import 'chat_composer.dart';
import 'chat_controller.dart';
import 'message_bubble.dart';
import 'models.dart';
import 'timeline.dart';
import 'threads_controller.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  bool _openingMeeting = false;
  @override
  void initState() {
    super.initState();
    // 会议卡片可能在上一个页面之后才有变化，进对话时刷新一次。
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(threadsProvider.notifier).refresh();
    });
  }

  /// 主对话右上角的会议入口：直接开始收音，结束时才创建会议。
  Future<void> _openNewMeeting() async {
    if (_openingMeeting) return;
    _openingMeeting = true;
    try {
      await context.push('/meeting/record');
    } finally {
      _openingMeeting = false;
    }
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _dismissKeyboard() => FocusManager.instance.primaryFocus?.unfocus();

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
    // 先清空，失败再还原：AI 要几秒，等响应回来才清会像「发了但没清」。
    _inputController.clear();
    // 发完收起键盘，别挡着回复。
    FocusManager.instance.primaryFocus?.unfocus();
    final ok = await ref
        .read(chatProvider(widget.threadId).notifier)
        .send(content);
    if (!mounted) return;
    if (!ok && _inputController.text.isEmpty) {
      _inputController.text = content;
      _inputController.selection = TextSelection.collapsed(
        offset: content.length,
      );
    }
  }

  Future<void> _retry() async {
    final controller = ref.read(chatProvider(widget.threadId).notifier);
    final pending = controller.pendingContent;
    final ok = await controller.retry();
    if (!mounted) return;
    if (ok && _inputController.text == pending) {
      _inputController.clear();
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
        final at = kind == ItemKind.reminder ? action.dueAt : action.scheduledAt;
        final suffix = at == null ? '' : '，已安排通知';
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
    final state = chat.value;

    ref.listen(chatProvider(widget.threadId), (previous, next) {
      final previousCount = previous?.value?.messages.length ?? 0;
      final nextCount = next.value?.messages.length ?? 0;
      if (nextCount != previousCount) _scrollToBottom();
    });

    final title = state?.thread.title;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: '返回',
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/');
            }
          },
        ),
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
          if (state?.thread.kind == ThreadKind.daily)
            IconButton(
              key: const ValueKey('start-meeting'),
              tooltip: '新建会议',
              onPressed: _openNewMeeting,
              icon: const Icon(Icons.call_outlined, size: 22),
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: _dismissKeyboard,
        child: chat.when(
          loading: () =>
              const Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
          error: (error, stackTrace) => ErrorView(
            message: error is ApiException ? error.userMessage : '加载失败，请重试',
            onRetry: () => ref.invalidate(chatProvider(widget.threadId)),
          ),
          data: (state) => _buildChat(state),
        ),
      ),
    );
  }

  Widget _buildChat(ChatState state) {
    final threads = ref.watch(threadsProvider).value ?? const <NotaThread>[];
    final meetings = state.thread.kind == ThreadKind.daily
        ? threads.where((thread) => thread.kind == ThreadKind.meeting).toList()
        : const <NotaThread>[];
    final entries = buildTimeline(messages: state.messages, meetings: meetings);

    return Column(
      children: [
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 860),
              child: entries.isEmpty
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
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      itemCount: entries.length,
                      itemBuilder: (context, index) {
                        final entry = entries[index];
                        final meeting = entry.meeting;
                        if (meeting != null) {
                          return _MeetingTile(thread: meeting);
                        }
                        final message = entry.message!;
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
        ChatComposer(
          controller: _inputController,
          sending: state.sending,
          onSend: _send,
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

/// 日常对话里代表一场会议：点进去继续那场会议。
class _MeetingTile extends StatelessWidget {
  const _MeetingTile({required this.thread});

  final NotaThread thread;

  @override
  Widget build(BuildContext context) {
    final title = thread.title.trim().isEmpty ? '未命名会议' : thread.title;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Material(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            child: InkWell(
              key: ValueKey('meeting-card-${thread.id}'),
              borderRadius: BorderRadius.circular(12),
              onTap: () => context.push('/chat/${thread.id}'),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.groups_outlined,
                      size: 18,
                      color: AppColors.sage,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            '会议',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      formatThreadTime(thread.createdAt),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      size: 18,
                      color: AppColors.muted,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
