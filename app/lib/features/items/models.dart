enum ItemKind {
  reminder,
  todo;

  static ItemKind fromWire(String value) => switch (value) {
    'reminder' => ItemKind.reminder,
    'todo' => ItemKind.todo,
    _ => throw FormatException('Unknown item kind: $value'),
  };

  String get wire => name;

  String get label => switch (this) {
    ItemKind.reminder => '提醒',
    ItemKind.todo => '待办',
  };
}

enum ItemStatus {
  open,
  done,
  deleted;

  static ItemStatus fromWire(String value) => switch (value) {
    'open' => ItemStatus.open,
    'done' => ItemStatus.done,
    'deleted' => ItemStatus.deleted,
    _ => throw FormatException('Unknown item status: $value'),
  };

  String get wire => name;
}

class Item {
  const Item({
    required this.id,
    required this.threadId,
    required this.kind,
    required this.title,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.dueAt,
    this.scheduledAt,
    this.sourceMessageId,
    this.candidateIndex,
  });

  factory Item.fromJson(Map<String, dynamic> json) {
    return Item(
      id: json['id'] as String,
      threadId: json['threadId'] as String,
      kind: ItemKind.fromWire(json['kind'] as String),
      title: json['title'] as String,
      dueAt: json['dueAt'] == null
          ? null
          : DateTime.parse(json['dueAt'] as String).toUtc(),
      scheduledAt: json['scheduledAt'] == null
          ? null
          : DateTime.parse(json['scheduledAt'] as String).toUtc(),
      sourceMessageId: json['sourceMessageId'] as String?,
      candidateIndex: (json['candidateIndex'] as num?)?.toInt(),
      status: ItemStatus.fromWire(json['status'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String).toUtc(),
      updatedAt: DateTime.parse(json['updatedAt'] as String).toUtc(),
    );
  }

  final String id;
  final String threadId;
  final ItemKind kind;
  final String title;
  /// 截止时间：必须在此之前完成。
  final DateTime? dueAt;

  /// 执行时间：打算什么时候做；只有用户或原文说了才存在。
  final DateTime? scheduledAt;
  final String? sourceMessageId;
  final int? candidateIndex;
  final ItemStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isCandidate => sourceMessageId != null && candidateIndex != null;

  /// 该在什么时候发通知：提醒用提醒时间，待办用执行时间，截止时间不发通知。
  DateTime? get notificationAt =>
      kind == ItemKind.reminder ? dueAt : scheduledAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'threadId': threadId,
    'kind': kind.wire,
    'title': title,
    if (dueAt != null) 'dueAt': dueAt!.toIso8601String(),
    if (scheduledAt != null) 'scheduledAt': scheduledAt!.toIso8601String(),
    if (sourceMessageId != null) 'sourceMessageId': sourceMessageId,
    if (candidateIndex != null) 'candidateIndex': candidateIndex,
    'status': status.wire,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
  };
}
