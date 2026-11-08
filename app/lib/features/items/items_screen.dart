import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/async_view.dart';
import '../../shared/widgets/confirm_dialog.dart';
import '../../shared/widgets/empty_view.dart';
import '../chat/models.dart';
import '../chat/threads_controller.dart';
import 'item_card.dart';
import 'item_edit_dialog.dart';
import 'items_controller.dart';
import 'models.dart';

class ItemsScreen extends ConsumerStatefulWidget {
  const ItemsScreen({super.key});

  @override
  ConsumerState<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends ConsumerState<ItemsScreen> {
  final Set<String> _busy = {};
  bool _openingChat = false;

  /// 首页只有一个入口：主对话（服务端已有的 daily thread）。
  Future<void> _openDailyChat() async {
    if (_openingChat) return;
    setState(() => _openingChat = true);
    try {
      final thread = await _dailyThread();
      if (!mounted) return;
      if (thread == null) {
        AppSnackBar.show(context, '还没准备好对话，请稍后再试', isError: true);
        return;
      }
      context.push('/chat/${thread.id}');
    } on ApiException catch (error) {
      if (mounted) {
        AppSnackBar.show(context, error.userMessage, isError: true);
      }
    } catch (_) {
      if (mounted) {
        AppSnackBar.show(context, '加载对话失败，请重试', isError: true);
      }
    } finally {
      if (mounted) setState(() => _openingChat = false);
    }
  }

  Future<NotaThread?> _dailyThread() async {
    // 首次进入时等 build 完成；已经处于错误态时 .future 会直接抛，交给下面的刷新重试。
    var threads = const <NotaThread>[];
    try {
      threads = await ref.read(threadsProvider.future);
    } catch (_) {
      // 忽略，下面刷新一次再判断。
    }
    final cached = _findDaily(threads);
    if (cached != null) return cached;

    // 列表只剩会议或上次刷新失败：补一次完整刷新。
    await ref.read(threadsProvider.notifier).refresh();
    final refreshed = _findDaily(
      ref.read(threadsProvider).value ?? const <NotaThread>[],
    );
    if (refreshed != null) return refreshed;

    final error = ref.read(threadsProvider).error;
    throw error is ApiException
        ? error
        : const ApiException(
            code: ApiErrorCode.network,
            message: '对话列表加载失败',
            retryable: true,
          );
  }

  NotaThread? _findDaily(List<NotaThread> threads) {
    for (final thread in threads) {
      if (thread.kind == ThreadKind.daily) return thread;
    }
    return null;
  }

  Future<void> _complete(Item item) async {
    await _run(item.id, () async {
      await ref.read(itemsProvider.notifier).complete(item);
      if (mounted) AppSnackBar.show(context, '已完成');
    });
  }

  Future<void> _edit(Item item) async {
    final result = await showItemEditDialog(context, item);
    if (result == null || !mounted) return;
    await _run(item.id, () async {
      await ref
          .read(itemsProvider.notifier)
          .updateItem(
            item,
            title: result.title,
            dueAt: result.dueAt,
            clearDueAt: result.clearDueAt,
            scheduledAt: result.scheduledAt,
            clearScheduledAt: result.clearScheduledAt,
          );
      if (mounted) AppSnackBar.show(context, '已更新');
    });
  }

  Future<void> _delete(Item item) async {
    final confirmed = await showConfirmDialog(
      context,
      title: '删除事项',
      message: '删除“${item.title}”？本机对应的提醒也会取消。',
      confirmLabel: '删除',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _run(item.id, () async {
      await ref.read(itemsProvider.notifier).delete(item);
      if (mounted) AppSnackBar.show(context, '已删除');
    });
  }

  Future<void> _run(String itemId, Future<void> Function() action) async {
    if (_busy.contains(itemId)) return;
    setState(() => _busy.add(itemId));
    try {
      await action();
    } on ApiException catch (error) {
      if (mounted) {
        AppSnackBar.show(context, error.userMessage, isError: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(itemId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(itemsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('事项'),
        actions: [
          IconButton(
            key: const ValueKey('open-profile'),
            tooltip: '我的',
            onPressed: () => context.push('/profile'),
            icon: const Icon(Icons.person_outline, size: 22),
          ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('open-daily'),
        onPressed: _openingChat ? null : _openDailyChat,
        backgroundColor: AppColors.ink,
        foregroundColor: AppColors.surface,
        icon: _openingChat
            ? const SizedBox(
                width: 17,
                height: 17,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.surface,
                ),
              )
            : const Icon(Icons.chat_bubble_outline, size: 19),
        label: const Text('对话'),
      ),
      body: AsyncView<List<Item>>(
        value: items,
        onRetry: () => ref.read(itemsProvider.notifier).refresh(),
        data: _buildList,
      ),
    );
  }

  Widget _buildList(List<Item> items) {
    final open = items.where((item) => item.status == ItemStatus.open).toList()
      ..sort((a, b) {
        final aDue = a.dueAt ?? a.scheduledAt;
        final bDue = b.dueAt ?? b.scheduledAt;
        if (aDue == null && bDue == null) return 0;
        if (aDue == null) return 1;
        if (bDue == null) return -1;
        return aDue.compareTo(bDue);
      });
    final done = items.where((item) => item.status == ItemStatus.done).toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    if (open.isEmpty && done.isEmpty) {
      return LayoutBuilder(
        builder: (context, constraints) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: RefreshIndicator(
              onRefresh: () => ref.read(itemsProvider.notifier).refresh(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: constraints.maxHeight,
                    child: const EmptyView(
                      icon: Icons.task_alt,
                      title: '还没有事项',
                      message: '在对话里说出要做的事，或把候选事项加入这里。',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760),
        child: RefreshIndicator(
          onRefresh: () => ref.read(itemsProvider.notifier).refresh(),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            children: [
              _SectionHeader(
                title: '未完成',
                count: open.length,
                muted: open.isEmpty,
              ),
              if (open.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 18),
                  child: Text(
                    '没有未完成的事项。',
                    style: TextStyle(fontSize: 13, color: AppColors.muted),
                  ),
                )
              else
                ...open.map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: ItemCard(
                      item: item,
                      busy: _busy.contains(item.id),
                      onComplete: () => _complete(item),
                      onEdit: () => _edit(item),
                      onDelete: () => _delete(item),
                    ),
                  ),
                ),
              if (done.isNotEmpty) ...[
                const SizedBox(height: 20),
                _SectionHeader(title: '已完成', count: done.length),
                const SizedBox(height: 2),
                ...done.map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: ItemCard(
                      item: item,
                      busy: _busy.contains(item.id),
                      onDelete: () => _delete(item),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.count,
    this.muted = false,
  });

  final String title;
  final int count;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: muted ? AppColors.muted : AppColors.ink,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '$count',
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}
