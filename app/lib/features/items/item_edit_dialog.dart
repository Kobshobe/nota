import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../shared/format.dart';
import 'models.dart';

class ItemEditResult {
  const ItemEditResult({
    required this.title,
    this.dueAt,
    this.clearDueAt = false,
  });

  final String title;
  final DateTime? dueAt;
  final bool clearDueAt;
}

Future<ItemEditResult?> showItemEditDialog(BuildContext context, Item item) {
  return showDialog<ItemEditResult>(
    context: context,
    builder: (context) => _ItemEditDialog(item: item),
  );
}

class _ItemEditDialog extends StatefulWidget {
  const _ItemEditDialog({required this.item});

  final Item item;

  @override
  State<_ItemEditDialog> createState() => _ItemEditDialogState();
}

class _ItemEditDialogState extends State<_ItemEditDialog> {
  late final TextEditingController _titleController;
  late DateTime? _dueAt;
  bool _clearDueAt = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.item.title);
    _dueAt = widget.item.dueAt;
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _pickDueAt() async {
    final now = DateTime.now();
    final initial = _dueAt?.toLocal() ?? now.add(const Duration(hours: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null || !mounted) return;
    setState(() {
      _dueAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      ).toUtc();
      _clearDueAt = false;
    });
  }

  void _clearTime() {
    setState(() {
      _dueAt = null;
      _clearDueAt = true;
    });
  }

  void _submit() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    Navigator.of(
      context,
    ).pop(ItemEditResult(title: title, dueAt: _dueAt, clearDueAt: _clearDueAt));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('编辑事项'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              key: const ValueKey('item-title-input'),
              controller: _titleController,
              autofocus: true,
              maxLength: 200,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
              decoration: const InputDecoration(labelText: '标题'),
            ),
            const SizedBox(height: 6),
            const Text(
              '时间',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: _pickDueAt,
              icon: const Icon(Icons.schedule, size: 18),
              label: Text(formatDueAt(_dueAt)),
            ),
            if (_dueAt != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      formatDateTime(_dueAt!),
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                  if (widget.item.kind == ItemKind.todo)
                    TextButton(
                      onPressed: _clearTime,
                      child: const Text('清除时间'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('item-edit-save'),
          onPressed: _submit,
          child: const Text('保存'),
        ),
      ],
    );
  }
}
