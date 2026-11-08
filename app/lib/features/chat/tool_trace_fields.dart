import '../../shared/format.dart';

/// 工具轨迹弹窗里的一行：中文标签 + 已翻译的值。
class ToolTraceField {
  const ToolTraceField(this.label, this.value);

  final String label;
  final String value;
}

const _labels = <String, String>{
  'title': '标题',
  'kind': '类型',
  'dueAt': '截止时间',
  'scheduledAt': '执行时间',
  'itemId': '事项',
  'tempId': '临时 ID',
  'query': '关键词',
  'status': '状态',
  'threadId': '会话',
  'reply': '回复',
  'summary': '摘要',
  'keyPoints': '要点',
  'actions': '候选事项',
  'owner': '负责人',
  'evidence': '依据',
  'confidence': '置信度',
  'items': '命中',
  'payload': '结果',
  'finished': '已收尾',
  'committed': '已提交',
  'error': '错误',
};

const _kindLabels = {'reminder': '提醒', 'todo': '待办'};
const _statusLabels = {'open': '未完成', 'done': '已完成', 'deleted': '已删除'};

List<ToolTraceField> describeToolArguments(Map<String, dynamic> args) {
  return _describe(args);
}

List<ToolTraceField> describeToolResult(Map<String, dynamic> result) {
  // finish 的结果是 `{finished, payload}`，展示 payload 本身更有意义。
  final payload = result['payload'];
  if (payload is Map) {
    return _describe(Map<String, dynamic>.from(payload));
  }
  return _describe(result);
}

List<ToolTraceField> _describe(Map<String, dynamic> values) {
  final fields = <ToolTraceField>[];
  for (final entry in values.entries) {
    fields.addAll(_describeEntry(entry.key, entry.value));
  }
  return fields;
}

List<ToolTraceField> _describeEntry(String key, Object? value) {
  final label = _labels[key] ?? key;
  if (value is List) {
    if (value.isEmpty) return [ToolTraceField(label, '无')];
    if (value.every((entry) => entry is Map)) {
      return [
        ToolTraceField(label, '${value.length} 条'),
        for (var index = 0; index < value.length; index++)
          ToolTraceField('${index + 1}', _summary(value[index] as Map)),
      ];
    }
    return [ToolTraceField(label, value.map(_scalar).join('、'))];
  }
  if (value is Map) {
    return [ToolTraceField(label, _summary(value))];
  }
  return [ToolTraceField(label, _scalar(value, key: key))];
}

/// 列表里的单条记录只保留人看得懂的字段，id 与时间戳是噪音。
const _summaryHidden = {
  'id',
  'threadId',
  'createdAt',
  'updatedAt',
  'sourceMessageId',
  'candidateIndex',
  'tempId',
};

String _summary(Map value) {
  final parts = <String>[];
  for (final entry in value.entries) {
    final key = '${entry.key}';
    if (_summaryHidden.contains(key)) continue;
    final label = _labels[key] ?? key;
    parts.add('$label=${_shorten(_scalar(entry.value, key: key))}');
  }
  return parts.isEmpty ? '无' : parts.join('；');
}

String _shorten(String value, [int max = 60]) {
  return value.length > max ? '${value.substring(0, max)}…' : value;
}

String _scalar(Object? value, {String? key}) {
  if (value == null) return '无';
  // 嵌套结构也渲染成 `键=值`，不把 Dart 的 Map/List 字符串化带进界面。
  if (value is Map) return _summary(value);
  if (value is List) return value.map((entry) => _scalar(entry)).join('、');
  if (value is num || value is bool) {
    if (key == 'confidence' && value is num) return '${(value * 100).round()}%';
    return '$value';
  }
  final text = '$value';
  if (key == 'kind') return _kindLabels[text] ?? text;
  if (key == 'status') return _statusLabels[text] ?? text;
  if (key == 'dueAt') {
    final parsed = DateTime.tryParse(text);
    return parsed == null ? text : formatDateTime(parsed);
  }
  return text;
}
