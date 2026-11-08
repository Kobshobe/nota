# Plan: 独立「我的」页

## Files

- `app/lib/features/profile/profile_screen.dart`（新）：邮箱、会员、额度、退出登录。
- `app/lib/core/router.dart`：新增 `/profile`。
- `app/lib/features/items/items_screen.dart`：AppBar 换成「我的」入口，移除额度徽标与退出登录代码。
- `app/lib/shared/widgets/quota_badge.dart`：删除（已无调用方）。
- `app/test/test_helpers.dart`：`testRoutedApp` 支持传入已登录的 `AuthStore`。
- `app/test/home_items_test.dart`：用 VIP/unlimited 数据断言事项页与主对话都没有 VIP/额度文案，有「我的」入口。
- `app/test/profile_test.dart`（新）：进入我的页、VIP/Free/额度失败文案、确认退出后清会话并回登录页。
- `docs/product.md`、`docs/engineering.md`：账号页与目录同步。

## Order

1. 变更链。
2. 我的页 + 路由 + 事项页入口。
3. 测试。
4. `make check-all`、重建 Web 与 iOS 包、独立 review 后提交。

## Proof

- `app/test/home_items_test.dart`：VIP 数据下事项页与主对话都没有 VIP/额度文案，有「我的」图标。
- `app/test/profile_test.dart`：我的页显示邮箱与 VIP；点退出登录出现确认弹窗。
- `make check-all` 全绿；Web 与 iOS 模拟器上「事项 → 我的 → 返回」可见。
