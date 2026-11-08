import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../items/items_controller.dart';
import '../items/models.dart';
import 'models.dart';
import 'threads_controller.dart';
import 'usage_controller.dart';

const int maxMessageLength = 20000;

final chatProvider = AsyncNotifierProvider.autoDispose
    .family<ChatController, ChatState, String>(ChatController.new);

class ChatState {
  const ChatState({
    required this.thread,
    required this.messages,
    this.toolCallsByMessageId = const {},
    this.createdActions = const {},
    this.sending = false,
    this.error,
  });

  final NotaThread thread;
  final List<ChatMessage> messages;
  final Map<String, List<ToolCall>> toolCallsByMessageId;
  final Set<String> createdActions;
  final bool sending;
  final ApiException? error;

  ChatState copyWith({
    NotaThread? thread,
    List<ChatMessage>? messages,
    Map<String, List<ToolCall>>? toolCallsByMessageId,
    Set<String>? createdActions,
    bool? sending,
    ApiException? error,
    bool clearError = false,
  }) {
    return ChatState(
      thread: thread ?? this.thread,
      messages: messages ?? this.messages,
      toolCallsByMessageId: toolCallsByMessageId ?? this.toolCallsByMessageId,
      createdActions: createdActions ?? this.createdActions,
      sending: sending ?? this.sending,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class ChatController extends AsyncNotifier<ChatState> {
  ChatController(this.threadId);

  final String threadId;
  final Random _random = Random();

  String? _pendingContent;
  String? _pendingClientMessageId;

  @override
  Future<ChatState> build() async {
    final api = ref.read(apiProvider);
    final detail = await api.getThread(threadId);
    final items = await api.listItems(threadId: threadId);
    return ChatState(
      thread: detail.thread,
      messages: detail.messages,
      toolCallsByMessageId: {
        for (final message in detail.messages)
          if (message.toolCalls.isNotEmpty) message.id: message.toolCalls,
      },
      createdActions: {
        for (final item in items)
          if (item.sourceMessageId != null && item.candidateIndex != null)
            '${item.sourceMessageId}:${item.candidateIndex}',
      },
    );
  }

  Future<bool> send(String content) async {
    final current = state.value;
    if (current == null || current.sending) return false;
    if (content.trim().isEmpty) return false;
    if (content.length > maxMessageLength) {
      state = AsyncData(
        current.copyWith(
          error: ApiException(
            code: ApiErrorCode.invalidInput,
            message: 'Message exceeds $maxMessageLength characters',
            displayMessage: '单条消息最多 20,000 字，请精简后再发送',
          ),
        ),
      );
      return false;
    }

    final reuseId =
        _pendingClientMessageId != null && _pendingContent == content;
    final clientMessageId = reuseId
        ? _pendingClientMessageId!
        : _newClientMessageId();
    _pendingContent = content;
    _pendingClientMessageId = clientMessageId;

    final optimistic = ChatMessage(
      id: 'local_$clientMessageId',
      role: MessageRole.user,
      content: content,
      createdAt: DateTime.now().toUtc(),
    );
    final keepAlive = ref.keepAlive();
    state = AsyncData(
      current.copyWith(
        messages: [...current.messages, optimistic],
        sending: true,
        clearError: true,
      ),
    );

    try {
      final result = await ref
          .read(apiProvider)
          .sendMessage(
            threadId: threadId,
            content: content,
            clientMessageId: clientMessageId,
          );
      final latest = state.value ?? current;
      final messages =
          latest.messages
              .where(
                (message) =>
                    message.id != optimistic.id &&
                    message.id != result.userMessage.id &&
                    message.id != result.assistantMessage.id,
              )
              .toList()
            ..add(result.userMessage)
            ..add(result.assistantMessage);
      var thread = latest.thread;
      final payloadTitle = result.assistantMessage.payload?.title?.trim();
      final hadAssistant = latest.messages.any(
        (message) => message.role == MessageRole.assistant,
      );
      if (!hadAssistant &&
          thread.kind == ThreadKind.meeting &&
          (thread.title.trim().isEmpty || thread.title == '新会议') &&
          payloadTitle != null &&
          payloadTitle.isNotEmpty) {
        thread = NotaThread(
          id: thread.id,
          kind: thread.kind,
          title: payloadTitle,
          createdAt: thread.createdAt,
          updatedAt: DateTime.now().toUtc(),
        );
      }
      state = AsyncData(
        latest.copyWith(
          thread: thread,
          messages: messages,
          toolCallsByMessageId: {
            ...latest.toolCallsByMessageId,
            result.assistantMessage.id: result.toolCalls,
          },
          sending: false,
          clearError: true,
        ),
      );
      _pendingContent = null;
      _pendingClientMessageId = null;

      ref.read(usageProvider.notifier).setUsage(result.usage);
      unawaited(ref.read(threadsProvider.notifier).refresh());
      unawaited(ref.read(itemsProvider.notifier).refresh());
      return true;
    } on ApiException catch (error) {
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(
          messages: latest.messages
              .where((message) => message.id != optimistic.id)
              .toList(),
          sending: false,
          error: error,
        ),
      );
      if (error.code == ApiErrorCode.quotaExceeded) {
        ref.invalidate(usageProvider);
      }
      return false;
    } finally {
      keepAlive.close();
    }
  }

  String? get pendingContent => _pendingContent;

  Future<bool> retry() async {
    final content = _pendingContent;
    if (content == null) return false;
    return send(content);
  }

  Future<Item?> addCandidateAction({
    required ChatMessage message,
    required int index,
    required CandidateAction action,
    required ItemKind kind,
  }) async {
    final current = state.value;
    if (current == null) return null;
    final key = '${message.id}:$index';
    if (current.createdActions.contains(key)) return null;

    final keepAlive = ref.keepAlive();
    try {
      final item = await ref
          .read(apiProvider)
          .createItem(
            threadId: threadId,
            kind: kind,
            title: action.title,
            dueAt: action.dueAt,
            scheduledAt: action.scheduledAt,
            sourceMessageId: message.id,
            candidateIndex: index,
          );
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(createdActions: {...latest.createdActions, key}),
      );
      unawaited(ref.read(itemsProvider.notifier).refresh());
      return item;
    } finally {
      keepAlive.close();
    }
  }

  void clearError() {
    final current = state.value;
    if (current == null || current.error == null) return;
    state = AsyncData(current.copyWith(clearError: true));
  }

  String _newClientMessageId() {
    return 'c_${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(1 << 20)}';
  }
}
