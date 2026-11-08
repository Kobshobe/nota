import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../shared/format.dart';
import 'models.dart';

class ItemCard extends StatelessWidget {
  const ItemCard({
    super.key,
    required this.item,
    this.busy = false,
    this.onComplete,
    this.onEdit,
    this.onDelete,
  });

  final Item item;
  final bool busy;
  final VoidCallback? onComplete;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final done = item.status == ItemStatus.done;
    final overdue = !done && isOverdue(item.dueAt);
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 10, 4, 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: overdue
              ? AppColors.danger.withValues(alpha: 0.35)
              : AppColors.border,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: done
                ? const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    child: Icon(
                      Icons.check_circle,
                      size: 22,
                      color: AppColors.sage,
                    ),
                  )
                : Checkbox(
                    value: false,
                    onChanged: busy || onComplete == null
                        ? null
                        : (_) => onComplete!(),
                  ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      height: 1.5,
                      color: done ? AppColors.muted : AppColors.ink,
                      decoration: done ? TextDecoration.lineThrough : null,
                      decorationColor: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 10,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            item.kind == ItemKind.reminder
                                ? Icons.alarm
                                : Icons.checklist,
                            size: 14,
                            color: AppColors.muted,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            item.kind.label,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                      if (item.kind == ItemKind.reminder && item.dueAt != null)
                        Text(
                          '提醒 ${formatDueAt(item.dueAt)}',
                          style: TextStyle(
                            fontSize: 12,
                            color: overdue ? AppColors.danger : AppColors.muted,
                            fontWeight: overdue
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      if (item.kind == ItemKind.todo && item.scheduledAt != null)
                        Text(
                          '执行 ${formatDueAt(item.scheduledAt)}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      if (item.kind == ItemKind.todo && item.dueAt != null)
                        Text(
                          '截止 ${formatDueAt(item.dueAt)}',
                          style: TextStyle(
                            fontSize: 12,
                            color: overdue ? AppColors.danger : AppColors.muted,
                            fontWeight: overdue
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      if (overdue)
                        const Text(
                          '已逾期',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.danger,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (busy)
            const Padding(
              padding: EdgeInsets.all(12),
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            PopupMenuButton<String>(
              tooltip: '更多操作',
              icon: const Icon(
                Icons.more_horiz,
                size: 20,
                color: AppColors.muted,
              ),
              onSelected: (value) {
                if (value == 'edit') onEdit?.call();
                if (value == 'delete') onDelete?.call();
              },
              itemBuilder: (context) => [
                if (!done && onEdit != null)
                  const PopupMenuItem(
                    value: 'edit',
                    child: Row(
                      children: [
                        Icon(Icons.edit_outlined, size: 18),
                        SizedBox(width: 10),
                        Text('编辑'),
                      ],
                    ),
                  ),
                if (onDelete != null)
                  const PopupMenuItem(
                    value: 'delete',
                    child: Row(
                      children: [
                        Icon(
                          Icons.delete_outline,
                          size: 18,
                          color: AppColors.danger,
                        ),
                        SizedBox(width: 10),
                        Text('删除', style: TextStyle(color: AppColors.danger)),
                      ],
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
