import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../shared/format.dart';
import '../items/models.dart';
import 'models.dart';
import 'tool_trace_fields.dart';

typedef AddCandidateAction = Future<bool> Function(
  CandidateAction action,
  ItemKind kind,
);

class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    this.toolCalls = const [],
    this.createdActions = const {},
    this.onAddAction,
  });

  final ChatMessage message;
  final List<ToolCall> toolCalls;
  final Set<String> createdActions;
  final AddCandidateAction? onAddAction;

  @override
  Widget build(BuildContext context) {
    if (message.role == MessageRole.user) {
      return _UserBubble(message: message);
    }
    if (message.role == MessageRole.system) {
      return _SystemNotice(message: message);
    }
    return _AssistantBubble(
      message: message,
      toolCalls: toolCalls,
      createdActions: createdActions,
      onAddAction: onAddAction,
    );
  }
}

/// 服务端写入的通知（例如设备会议整理完成）：居中一条，可跳到会议。
class _SystemNotice extends StatelessWidget {
  const _SystemNotice({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final meetingThreadId = message.payload?.meetingThreadId;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          padding: const EdgeInsets.only(left: 14, right: 4, top: 2, bottom: 2),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.notifications_none,
                size: 16,
                color: AppColors.muted,
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    message.content,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ),
              if (meetingThreadId != null && meetingThreadId.isNotEmpty)
                TextButton(
                  onPressed: () => context.push('/chat/$meetingThreadId'),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    minimumSize: const Size(0, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('查看会议', style: TextStyle(fontSize: 13)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Container(
            constraints: const BoxConstraints(maxWidth: 560),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.sage,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(18),
                topRight: Radius.circular(18),
                bottomLeft: Radius.circular(18),
                bottomRight: Radius.circular(4),
              ),
            ),
            child: SelectableText(
              message.content,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                height: 1.55,
              ),
            ),
          ),
          const SizedBox(height: 5),
          Text(
            formatMessageTime(message.createdAt),
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class _AssistantBubble extends StatelessWidget {
  const _AssistantBubble({
    required this.message,
    required this.toolCalls,
    required this.createdActions,
    required this.onAddAction,
  });

  final ChatMessage message;
  final List<ToolCall> toolCalls;
  final Set<String> createdActions;
  final AddCandidateAction? onAddAction;

  @override
  Widget build(BuildContext context) {
    final payload = message.payload;
    final summary = payload?.summary?.trim();
    final reply = payload?.reply?.trim();
    final content = message.content.trim();
    final body = (reply != null && reply.isNotEmpty && reply != summary)
        ? reply
        : (content.isNotEmpty && content != summary)
        ? content
        : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            constraints: const BoxConstraints(maxWidth: 620),
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(4),
                topRight: Radius.circular(18),
                bottomLeft: Radius.circular(18),
                bottomRight: Radius.circular(18),
              ),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (payload?.title?.trim().isNotEmpty ?? false) ...[
                  Text(
                    payload!.title!.trim(),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                ],
                if (body != null && body.isNotEmpty)
                  SelectableText(body, style: const TextStyle(height: 1.65)),
                if (summary != null && summary.isNotEmpty) ...[
                  if (body != null && body.isNotEmpty)
                    const SizedBox(height: 12),
                  SelectableText(summary, style: const TextStyle(height: 1.65)),
                ],
                if (payload?.keyPoints.isNotEmpty ?? false) ...[
                  const SizedBox(height: 14),
                  const _SectionLabel('重点'),
                  const SizedBox(height: 6),
                  ...payload!.keyPoints.map(
                    (point) => _BulletLine(text: point),
                  ),
                ],
                if (payload?.actions.isNotEmpty ?? false) ...[
                  const SizedBox(height: 16),
                  const _SectionLabel('候选事项'),
                  const SizedBox(height: 8),
                  ...payload!.actions.asMap().entries.map(
                    (entry) => _CandidateActionCard(
                      key: ValueKey('${message.id}:${entry.key}'),
                      action: entry.value,
                      created: createdActions.contains(
                        '${message.id}:${entry.key}',
                      ),
                      onAdd: onAddAction == null
                          ? null
                          : (kind) => onAddAction!(entry.value, kind),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Text(
                      '确认候选事项不消耗额度',
                      style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                    ),
                  ),
                ],
                if (toolCalls.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  ToolTrace(toolCalls: toolCalls),
                ],
              ],
            ),
          ),
          const SizedBox(height: 5),
          Text(
            formatMessageTime(message.createdAt),
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: AppColors.muted,
        letterSpacing: 0.4,
      ),
    );
  }
}

class _BulletLine extends StatelessWidget {
  const _BulletLine({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 7, right: 8),
            child: SizedBox(
              width: 5,
              height: 5,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.terracotta,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
          Expanded(
            child: SelectableText(text, style: const TextStyle(height: 1.55)),
          ),
        ],
      ),
    );
  }
}

class _CandidateActionCard extends StatefulWidget {
  const _CandidateActionCard({
    super.key,
    required this.action,
    required this.created,
    this.onAdd,
  });

  final CandidateAction action;
  final bool created;
  final Future<bool> Function(ItemKind kind)? onAdd;

  @override
  State<_CandidateActionCard> createState() => _CandidateActionCardState();
}

class _CandidateActionCardState extends State<_CandidateActionCard> {
  bool _busy = false;

  Future<void> _add(ItemKind kind) async {
    if (_busy || widget.onAdd == null) return;
    setState(() => _busy = true);
    try {
      await widget.onAdd!(kind);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final action = widget.action;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.paper.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                action.dueAt == null
                    ? Icons.check_box_outlined
                    : Icons.notifications_none,
                size: 18,
                color: AppColors.terracotta,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  action.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
          if (action.owner != null ||
              action.dueAt != null ||
              action.scheduledAt != null) ...[
            const SizedBox(height: 7),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                if (action.owner != null)
                  _MetaChip(icon: Icons.person_outline, text: action.owner!),
                if (action.scheduledAt != null)
                  _MetaChip(
                    icon: Icons.play_circle_outline,
                    text: '执行 ${formatDueAt(action.scheduledAt)}',
                  ),
                if (action.dueAt != null)
                  _MetaChip(
                    icon: Icons.schedule,
                    text: '截止 ${formatDueAt(action.dueAt)}',
                  ),
              ],
            ),
          ],
          if (action.evidence != null &&
              action.evidence!.trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              '“${action.evidence!.trim()}”',
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.muted,
                height: 1.5,
              ),
            ),
          ],
          const SizedBox(height: 10),
          if (widget.created)
            const Row(
              children: [
                Icon(Icons.check_circle, size: 17, color: AppColors.sage),
                SizedBox(width: 6),
                Text(
                  '已加入事项',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: AppColors.sage,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _add(ItemKind.todo),
                  icon: _busy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.checklist, size: 17),
                  label: const Text('加入待办'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 38),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                ),
                if (action.dueAt != null)
                  FilledButton.icon(
                    onPressed: _busy ? null : () => _add(ItemKind.reminder),
                    icon: const Icon(Icons.alarm_add, size: 17),
                    label: const Text('加入提醒'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 38),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.muted),
        const SizedBox(width: 4),
        Text(
          text,
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
        ),
      ],
    );
  }
}

class ToolTrace extends StatelessWidget {
  const ToolTrace({super.key, required this.toolCalls});

  final List<ToolCall> toolCalls;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: toolCalls
          .map(
            (call) => ActionChip(
              avatar: const Icon(
                Icons.auto_awesome_outlined,
                size: 14,
                color: AppColors.sage,
              ),
              label: Text(call.name.label),
              onPressed: () => _showToolCall(context, call),
              visualDensity: VisualDensity.compact,
              side: const BorderSide(color: AppColors.border),
              backgroundColor: AppColors.paper.withValues(alpha: 0.6),
            ),
          )
          .toList(),
    );
  }

  void _showToolCall(BuildContext context, ToolCall call) {
    final arguments = describeToolArguments(call.arguments);
    final result = describeToolResult(call.result);
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(call.name.label),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (arguments.isNotEmpty)
                _ToolFieldSection(title: '参数', fields: arguments),
              if (arguments.isNotEmpty && result.isNotEmpty)
                const SizedBox(height: 16),
              if (result.isNotEmpty) _ToolFieldSection(title: '结果', fields: result),
              if (arguments.isEmpty && result.isEmpty)
                const Text(
                  '这次调用没有参数和返回内容',
                  style: TextStyle(fontSize: 13, color: AppColors.muted),
                ),
              const SizedBox(height: 16),
              Text(
                '执行于 ${formatDateTime(call.createdAt)}',
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }
}

class _ToolFieldSection extends StatelessWidget {
  const _ToolFieldSection({required this.title, required this.fields});

  final String title;
  final List<ToolTraceField> fields;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
        ),
        const SizedBox(height: 6),
        for (final field in fields)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 76,
                  child: Text(
                    field.label,
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ),
                Expanded(
                  child: SelectableText(
                    field.value,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: field.label == '错误' ? AppColors.danger : AppColors.ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
