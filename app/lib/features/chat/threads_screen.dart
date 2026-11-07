import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/auth_store.dart';
import '../../core/theme.dart';
import '../../shared/format.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/async_view.dart';
import '../../shared/widgets/confirm_dialog.dart';
import '../../shared/widgets/empty_view.dart';
import 'models.dart';
import 'threads_controller.dart';

class ThreadsScreen extends ConsumerStatefulWidget {
  const ThreadsScreen({super.key});

  @override
  ConsumerState<ThreadsScreen> createState() => _ThreadsScreenState();
}

class _ThreadsScreenState extends ConsumerState<ThreadsScreen> {
  bool _autoOpenedDaily = false;
  bool _creatingMeeting = false;

  Future<void> _openCreateMeeting() async {
    if (_creatingMeeting) return;
    final title = await _showCreateMeetingDialog();
    if (title == null || !mounted) return;

    setState(() => _creatingMeeting = true);
    try {
      final thread = await ref
          .read(threadsProvider.notifier)
          .createMeeting(title: title.isEmpty ? null : title);
      if (!mounted) return;
      context.push('/chat/${thread.id}');
    } on ApiException catch (error) {
      if (mounted) {
        AppSnackBar.show(context, error.userMessage, isError: true);
      }
    } finally {
      if (mounted) setState(() => _creatingMeeting = false);
    }
  }

  Future<String?> _showCreateMeetingDialog() {
    return showDialog<String>(
      context: context,
      builder: (context) => const _CreateMeetingDialog(),
    );
  }

  Future<void> _logout() async {
    final confirmed = await showConfirmDialog(
      context,
      title: '退出登录',
      message: '退出后本机已安排的提醒会一并取消。',
      confirmLabel: '退出',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await ref.read(authStoreProvider).clear();
  }

  @override
  Widget build(BuildContext context) {
    final threads = ref.watch(threadsProvider);

    ref.listen<AsyncValue<List<NotaThread>>>(threadsProvider, (_, next) {
      if (_autoOpenedDaily) return;
      final list = next.value;
      if (list == null) return;
      NotaThread? daily;
      for (final thread in list) {
        if (thread.kind == ThreadKind.daily) {
          daily = thread;
          break;
        }
      }
      if (daily == null) return;
      _autoOpenedDaily = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        GoRouter.maybeOf(context)?.push('/chat/${daily!.id}');
      });
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('对话'),
        actions: [
          IconButton(
            tooltip: '退出登录',
            onPressed: _logout,
            icon: const Icon(Icons.logout, size: 20),
          ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('new-meeting'),
        onPressed: _creatingMeeting ? null : _openCreateMeeting,
        backgroundColor: AppColors.ink,
        foregroundColor: AppColors.surface,
        icon: _creatingMeeting
            ? const SizedBox(
                width: 17,
                height: 17,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.surface,
                ),
              )
            : const Icon(Icons.add_comment_outlined, size: 19),
        label: const Text('新建会议'),
      ),
      body: AsyncView<List<NotaThread>>(
        value: threads,
        onRetry: () => ref.read(threadsProvider.notifier).refresh(),
        isEmpty: (list) => list.isEmpty,
        empty: EmptyView(
          icon: Icons.forum_outlined,
          title: '还没有对话',
          message: '新建一个会议，或直接在“日常”里记下第一句话。',
          action: OutlinedButton.icon(
            onPressed: _openCreateMeeting,
            icon: const Icon(Icons.add_comment_outlined, size: 18),
            label: const Text('新建会议'),
          ),
        ),
        data: (list) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: RefreshIndicator(
              onRefresh: () => ref.read(threadsProvider.notifier).refresh(),
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                itemCount: list.length,
                separatorBuilder: (context, index) =>
                    const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final thread = list[index];
                  return _ThreadTile(
                    thread: thread,
                    onTap: () => context.push('/chat/${thread.id}'),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CreateMeetingDialog extends StatefulWidget {
  const _CreateMeetingDialog();

  @override
  State<_CreateMeetingDialog> createState() => _CreateMeetingDialogState();
}

class _CreateMeetingDialogState extends State<_CreateMeetingDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('新建会议'),
      content: TextField(
        key: const ValueKey('meeting-title'),
        controller: _controller,
        autofocus: true,
        maxLength: 100,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        decoration: const InputDecoration(
          labelText: '会议标题（可选）',
          hintText: '例如：周一产品同步',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(onPressed: _submit, child: const Text('创建')),
      ],
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.onTap});

  final NotaThread thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDaily = thread.kind == ThreadKind.daily;
    final title = thread.title.trim().isEmpty
        ? (isDaily ? '日常' : '未命名会议')
        : thread.title;
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: (isDaily ? AppColors.sage : AppColors.terracotta)
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  isDaily ? Icons.wb_sunny_outlined : Icons.groups_outlined,
                  size: 21,
                  color: isDaily ? AppColors.sage : AppColors.terracotta,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${thread.kind.label} · ${formatThreadTime(thread.updatedAt)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
