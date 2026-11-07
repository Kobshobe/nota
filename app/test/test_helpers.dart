import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nota/core/api.dart';
import 'package:nota/core/auth_store.dart';
import 'package:nota/core/notifications.dart';
import 'package:nota/core/theme.dart';
import 'package:nota/features/auth/models.dart';
import 'package:nota/features/chat/models.dart';
import 'package:nota/features/items/models.dart';

class FakeNotificationService implements AppNotificationService {
  final List<Item> scheduled = [];
  final List<String> cancelled = [];
  int cancelAllCalls = 0;

  @override
  bool get supported => true;

  @override
  Future<void> init() async {}

  @override
  Future<void> schedule(Item item) async {
    scheduled.add(item);
  }

  @override
  Future<void> cancel(String itemId) async {
    cancelled.add(itemId);
  }

  @override
  Future<void> cancelAll() async {
    cancelAllCalls++;
  }
}

class FakeApi implements NotaApi {
  FakeApi({List<NotaThread>? threads, this.detail, List<Item>? items})
    : threads = threads ?? [],
      items = items ?? [];

  List<NotaThread> threads;
  ThreadDetail? detail;
  List<Item> items;
  Usage usage = Usage(
    used: 0,
    limit: 10,
    unlimited: false,
    date: '2026-11-08',
    resetsAt: DateTime.utc(2026, 11, 9),
  );

  ApiException? loginError;
  ApiException? sendError;
  bool failFirstSend = false;
  Completer<void>? sendGate;
  MessagePayload responsePayload = const MessagePayload(
    title: '已记录',
    summary: '好的，已记下。',
  );
  List<ToolCall> responseToolCalls = const [];

  int loginCalls = 0;
  String? lastLoginEmail;
  final List<({String content, String clientMessageId})> sends = [];
  final List<
    ({
      String threadId,
      ItemKind kind,
      String title,
      DateTime? dueAt,
      String? sourceMessageId,
      int? candidateIndex,
    })
  >
  createItemCalls = [];
  final List<String> deletedIds = [];
  final List<String> completedIds = [];

  @override
  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    loginCalls++;
    lastLoginEmail = email;
    if (loginError != null) throw loginError!;
    return AuthResult(
      token: 'test-token',
      user: NotaUser(email: email, isVip: false),
    );
  }

  @override
  Future<NotaUser> me() async =>
      const NotaUser(email: 'test@example.com', isVip: false);

  @override
  Future<List<NotaThread>> listThreads() async => List.of(threads);

  @override
  Future<NotaThread> createThread({String? title}) async {
    final now = DateTime.now().toUtc();
    final thread = NotaThread(
      id: 'thread-${threads.length + 1}',
      kind: ThreadKind.meeting,
      title: title ?? '',
      createdAt: now,
      updatedAt: now,
    );
    threads = [thread, ...threads];
    return thread;
  }

  @override
  Future<ThreadDetail> getThread(String threadId) async {
    final current = detail;
    if (current == null || current.thread.id != threadId) {
      throw const ApiException(
        code: ApiErrorCode.notFound,
        message: 'Thread not found',
        statusCode: 404,
      );
    }
    return current;
  }

  @override
  Future<SendMessageResult> sendMessage({
    required String threadId,
    required String content,
    required String clientMessageId,
  }) async {
    sends.add((content: content, clientMessageId: clientMessageId));
    if (failFirstSend && sends.length == 1) {
      throw const ApiException(
        code: ApiErrorCode.internal,
        message: 'Server exploded',
        statusCode: 500,
        retryable: true,
      );
    }
    if (sendError != null) throw sendError!;
    if (sendGate != null) await sendGate!.future;

    final now = DateTime.now().toUtc();
    final userMessage = ChatMessage(
      id: 'user-${sends.length}',
      role: MessageRole.user,
      content: content,
      createdAt: now,
    );
    final assistantMessage = ChatMessage(
      id: 'assistant-${sends.length}',
      role: MessageRole.assistant,
      content: responsePayload.reply ?? responsePayload.summary ?? '好的',
      payload: responsePayload,
      createdAt: now,
    );
    usage = Usage(
      used: usage.used + 1,
      limit: usage.limit,
      unlimited: usage.unlimited,
      date: usage.date,
      resetsAt: usage.resetsAt,
    );
    return SendMessageResult(
      userMessage: userMessage,
      assistantMessage: assistantMessage,
      toolCalls: responseToolCalls,
      items: const [],
      usage: usage,
    );
  }

  @override
  Future<List<Item>> listItems({ItemStatus? status, String? threadId}) async {
    return items
        .where((item) => status == null || item.status == status)
        .where((item) => threadId == null || item.threadId == threadId)
        .toList();
  }

  @override
  Future<Item> createItem({
    required String threadId,
    required ItemKind kind,
    required String title,
    DateTime? dueAt,
    String? sourceMessageId,
    int? candidateIndex,
  }) async {
    createItemCalls.add((
      threadId: threadId,
      kind: kind,
      title: title,
      dueAt: dueAt,
      sourceMessageId: sourceMessageId,
      candidateIndex: candidateIndex,
    ));
    final now = DateTime.now().toUtc();
    final item = Item(
      id: 'item-${items.length + 1}',
      threadId: threadId,
      kind: kind,
      title: title,
      dueAt: dueAt,
      sourceMessageId: sourceMessageId,
      candidateIndex: candidateIndex,
      status: ItemStatus.open,
      createdAt: now,
      updatedAt: now,
    );
    items.add(item);
    return item;
  }

  @override
  Future<Item> updateItem({
    required String itemId,
    String? title,
    DateTime? dueAt,
    bool clearDueAt = false,
  }) async {
    final index = items.indexWhere((item) => item.id == itemId);
    final old = items[index];
    final updated = Item(
      id: old.id,
      threadId: old.threadId,
      kind: old.kind,
      title: title ?? old.title,
      dueAt: clearDueAt ? null : (dueAt ?? old.dueAt),
      sourceMessageId: old.sourceMessageId,
      candidateIndex: old.candidateIndex,
      status: old.status,
      createdAt: old.createdAt,
      updatedAt: DateTime.now().toUtc(),
    );
    items[index] = updated;
    return updated;
  }

  @override
  Future<Item> completeItem(String itemId) async {
    completedIds.add(itemId);
    final index = items.indexWhere((item) => item.id == itemId);
    final old = items[index];
    final updated = Item(
      id: old.id,
      threadId: old.threadId,
      kind: old.kind,
      title: old.title,
      dueAt: old.dueAt,
      sourceMessageId: old.sourceMessageId,
      candidateIndex: old.candidateIndex,
      status: ItemStatus.done,
      createdAt: old.createdAt,
      updatedAt: DateTime.now().toUtc(),
    );
    items[index] = updated;
    return updated;
  }

  @override
  Future<void> deleteItem(String itemId) async {
    deletedIds.add(itemId);
    items.removeWhere((item) => item.id == itemId);
  }

  @override
  Future<Usage> getUsage() async => usage;
}

Widget testApp(
  Widget screen, {
  required FakeApi api,
  FakeNotificationService? notifications,
}) {
  final store = AuthStore(MemoryTokenStorage());
  return ProviderScope(
    overrides: [
      apiProvider.overrideWithValue(api),
      authStoreProvider.overrideWithValue(store),
      notificationServiceProvider.overrideWithValue(
        notifications ?? FakeNotificationService(),
      ),
    ],
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: const Locale('zh', 'CN'),
      supportedLocales: const [Locale('zh', 'CN')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: screen,
    ),
  );
}

Future<void> pumpUntil(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 3),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 50));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('等待 $finder 超时');
}
