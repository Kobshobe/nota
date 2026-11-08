import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../shared/format.dart';
import 'models.dart';

class ItemEditResult {
  const ItemEditResult({
    required this.title,
    this.dueAt,
    this.clearDueAt = false,
    this.scheduledAt,
    this.clearScheduledAt = false,
  });

  final String title;
  final DateTime? dueAt;
  final bool clearDueAt;
  final DateTime? scheduledAt;
  final bool clearScheduledAt;
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
  late DateTime? _scheduledAt;
  bool _clearDueAt = false;
  bool _clearScheduledAt = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.item.title);
    _dueAt = widget.item.dueAt;
    _scheduledAt = widget.item.scheduledAt;
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  Future<DateTime?> _pickMoment(DateTime? current) async {
    final now = DateTime.now();
    final initial = current?.toLocal() ?? now.add(const Duration(hours: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null || !mounted) return null;
    return DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    ).toUtc();
  }

  Future<void> _pickDueAt() async {
    final picked = await _pickMoment(_dueAt);
    if (picked == null || !mounted) return;
    setState(() {
      _dueAt = picked;
      _clearDueAt = false;
    });
  }

  Future<void> _pickScheduledAt() async {
    final picked = await _pickMoment(_scheduledAt);
    if (picked == null || !mounted) return;
    setState(() {
      _scheduledAt = picked;
      _clearScheduledAt = false;
    });
  }

  void _clearDueAtTime() {
    setState(() {
      _dueAt = null;
      _clearDueAt = true;
    });
  }

  void _clearScheduledTime() {
    setState(() {
      _scheduledAt = null;
      _clearScheduledAt = true;
    });
  }

  void _submit() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    Navigator.of(
      context,
    ).pop(
      ItemEditResult(
        title: title,
        dueAt: _dueAt,
        clearDueAt: _clearDueAt,
        scheduledAt: _scheduledAt,
        clearScheduledAt: _clearScheduledAt,
      ),
    );
  }

  Widget _timeField({
    required String label,
    required String hint,
    required DateTime? value,
    required Future<void> Function() onPick,
    required VoidCallback? onClear,
    required Key fieldKey,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            OutlinedButton.icon(
              key: fieldKey,
              onPressed: onPick,
              icon: const Icon(Icons.schedule, size: 18),
              label: Text(value == null ? hint : formatDueAt(value)),
            ),
            if (onClear != null)
              TextButton(onPressed: onClear, child: const Text('清除')),
          ],
        ),
      ],
    );
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
            const SizedBox(height: 10),
            if (widget.item.kind == ItemKind.todo) ...[
              _timeField(
                label: '执行时间',
                hint: '打算什么时候做，到点提醒',
                value: _scheduledAt,
                onPick: _pickScheduledAt,
                onClear: _scheduledAt == null ? null : _clearScheduledTime,
                fieldKey: const ValueKey('item-scheduled-at'),
              ),
              const SizedBox(height: 10),
              _timeField(
                label: '截止时间',
                hint: '必须完成的时间，过期会标红',
                value: _dueAt,
                onPick: _pickDueAt,
                onClear: _dueAt == null ? null : _clearDueAtTime,
                fieldKey: const ValueKey('item-due-at'),
              ),
            ] else
              _timeField(
                label: '提醒时间',
                hint: '到点发通知',
                value: _dueAt,
                onPick: _pickDueAt,
                onClear: null,
                fieldKey: const ValueKey('item-due-at'),
              ),
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
