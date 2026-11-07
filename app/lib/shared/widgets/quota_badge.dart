import 'package:flutter/material.dart';

import '../../core/theme.dart';

class QuotaBadge extends StatelessWidget {
  const QuotaBadge({
    super.key,
    required this.used,
    required this.limit,
    required this.unlimited,
  });

  factory QuotaBadge.loading() {
    return const QuotaBadge(used: 0, limit: 0, unlimited: false);
  }

  final int used;
  final int limit;
  final bool unlimited;

  @override
  Widget build(BuildContext context) {
    final exhausted = !unlimited && limit > 0 && used >= limit;
    final text = limit == 0
        ? '额度'
        : unlimited
        ? 'VIP · 不限次'
        : '$used / $limit';
    final color = exhausted ? AppColors.terracotta : AppColors.sage;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}
