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
      status: ItemStatus.fromWire(json['status'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String).toUtc(),
      updatedAt: DateTime.parse(json['updatedAt'] as String).toUtc(),
    );
  }

  final String id;
  final String threadId;
  final ItemKind kind;
  final String title;
  final DateTime? dueAt;
  final ItemStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'threadId': threadId,
    'kind': kind.wire,
    'title': title,
    if (dueAt != null) 'dueAt': dueAt!.toIso8601String(),
    'status': status.wire,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
  };
}
