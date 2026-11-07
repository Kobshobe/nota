import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/async_view.dart';
import '../../shared/widgets/confirm_dialog.dart';
import '../../shared/widgets/empty_view.dart';
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
      appBar: AppBar(title: const Text('事项')),
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
        final aDue = a.dueAt;
        final bDue = b.dueAt;
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
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
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
