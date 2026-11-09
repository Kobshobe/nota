import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/auth_store.dart';
import '../../core/theme.dart';
import '../../shared/widgets/app_snack_bar.dart';
import '../../shared/widgets/confirm_dialog.dart';
import '../../shared/widgets/section_card.dart';
import '../chat/models.dart';
import '../chat/usage_controller.dart';

/// 账号页：邮箱、会员状态、今日额度和退出登录。
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  @override
  void initState() {
    super.initState();
    // 已经有缓存时刷新一次（额度会跨天重置）；没有缓存就让首帧自己拉，避免两次请求。
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (ref.read(usageProvider).hasValue) ref.invalidate(usageProvider);
    });
  }

  bool _checkingCharge = false;

  /// 演示与排查入口：问后端最近一条可疑扣费是什么情况。
  Future<void> _checkChargeAnomaly() async {
    if (_checkingCharge) return;
    setState(() => _checkingCharge = true);
    try {
      final check = await ref.read(apiProvider).checkChargeAnomaly();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('误扣费检测'),
          content: Text(check.message, key: const ValueKey('charge-check-message')),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('知道了'),
            ),
          ],
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      AppSnackBar.show(context, error.userMessage, isError: true);
    } finally {
      if (mounted) setState(() => _checkingCharge = false);
    }
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
    final account = ref.watch(authStoreProvider);
    final user = account.user;
    final usage = ref.watch(usageProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: '返回',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        titleSpacing: 0,
        title: const Text('我的'),
      ),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              children: [
                SectionCard(
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor: AppColors.paper,
                        child: Text(
                          _initial(user?.email),
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.email ?? '账号信息不可用',
                              key: const ValueKey('profile-email'),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                            if (user != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                user.isVip ? 'VIP · 不限次' : 'Free 版',
                                key: const ValueKey('profile-plan'),
                                style: const TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '今日额度',
                        style: TextStyle(fontSize: 13, color: AppColors.muted),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _quotaText(usage),
                        key: const ValueKey('profile-quota'),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        '每天 0 点重置。',
                        style: TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  key: const ValueKey('profile-check-charge'),
                  onPressed: _checkingCharge ? null : _checkChargeAnomaly,
                  icon: const Icon(Icons.rule_folder_outlined, size: 18),
                  label: const Text('检测误扣费'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.ink,
                    side: const BorderSide(color: AppColors.border),
                    minimumSize: const Size.fromHeight(48),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const ValueKey('profile-logout'),
                  onPressed: _logout,
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('退出登录'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.border),
                    minimumSize: const Size.fromHeight(48),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// 取第一个字符；emoji 之类的代理对按 rune 取，不会截断成半个字符。
  String _initial(String? email) {
    if (email == null || email.isEmpty) return '?';
    return String.fromCharCode(email.runes.first).toUpperCase();
  }

  String _quotaText(AsyncValue<Usage> usage) {
    if (usage.hasError) return '额度加载失败';
    final value = usage.value;
    if (value == null) return '额度加载中…';
    if (value.unlimited) return '不限次';
    return '${value.used} / ${value.limit}';
  }
}
