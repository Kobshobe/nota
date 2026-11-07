import '../items/models.dart';

enum ThreadKind {
  daily,
  meeting;

  static ThreadKind fromWire(String value) => switch (value) {
    'daily' => ThreadKind.daily,
    'meeting' => ThreadKind.meeting,
    _ => throw FormatException('Unknown thread kind: $value'),
  };

  String get wire => name;

  String get label => switch (this) {
    ThreadKind.daily => '日常',
    ThreadKind.meeting => '会议',
  };
}

class NotaThread {
  const NotaThread({
    required this.id,
    required this.kind,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
  });

  factory NotaThread.fromJson(Map<String, dynamic> json) {
    return NotaThread(
      id: json['id'] as String,
      kind: ThreadKind.fromWire(json['kind'] as String),
      title: json['title'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String).toUtc(),
      updatedAt: DateTime.parse(json['updatedAt'] as String).toUtc(),
    );
  }

  final String id;
  final ThreadKind kind;
  final String title;
  final DateTime createdAt;
  final DateTime updatedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'kind': kind.wire,
    'title': title,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
  };
}

enum MessageRole {
  user,
  assistant;

  static MessageRole fromWire(String value) => switch (value) {
    'user' => MessageRole.user,
    'assistant' => MessageRole.assistant,
    _ => throw FormatException('Unknown message role: $value'),
  };

  String get wire => name;
}

class ThreadDetail {
  const ThreadDetail({required this.thread, required this.messages});

  factory ThreadDetail.fromJson(Map<String, dynamic> json) {
    return ThreadDetail(
      thread: NotaThread.fromJson(json['thread'] as Map<String, dynamic>),
      messages: (json['messages'] as List<dynamic>)
          .map((entry) => ChatMessage.fromJson(entry as Map<String, dynamic>))
          .toList(),
    );
  }

  final NotaThread thread;
  final List<ChatMessage> messages;

  Map<String, dynamic> toJson() => {
    'thread': thread.toJson(),
    'messages': messages.map((message) => message.toJson()).toList(),
  };
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    this.payload,
    this.toolCalls = const [],
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id'] as String,
      role: MessageRole.fromWire(json['role'] as String),
      content: json['content'] as String,
      payload: json['payload'] == null
          ? null
          : MessagePayload.fromJson(json['payload'] as Map<String, dynamic>),
      toolCalls:
          (json['toolCalls'] as List<dynamic>?)
              ?.map((entry) => ToolCall.fromJson(entry as Map<String, dynamic>))
              .toList() ??
          const [],
      createdAt: DateTime.parse(json['createdAt'] as String).toUtc(),
    );
  }

  final String id;
  final MessageRole role;
  final String content;
  final MessagePayload? payload;
  final List<ToolCall> toolCalls;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'role': role.wire,
    'content': content,
    if (payload != null) 'payload': payload!.toJson(),
    if (toolCalls.isNotEmpty)
      'toolCalls': toolCalls.map((toolCall) => toolCall.toJson()).toList(),
    'createdAt': createdAt.toIso8601String(),
  };
}

class MessagePayload {
  const MessagePayload({
    this.title,
    this.summary,
    this.keyPoints = const [],
    this.actions = const [],
    this.reply,
  });

  factory MessagePayload.fromJson(Map<String, dynamic> json) {
    return MessagePayload(
      title: json['title'] as String?,
      summary: json['summary'] as String?,
      keyPoints:
          (json['keyPoints'] as List<dynamic>?)
              ?.map((entry) => entry as String)
              .toList() ??
          const [],
      actions:
          (json['actions'] as List<dynamic>?)
              ?.map(
                (entry) =>
                    CandidateAction.fromJson(entry as Map<String, dynamic>),
              )
              .toList() ??
          const [],
      reply: json['reply'] as String?,
    );
  }

  final String? title;
  final String? summary;
  final List<String> keyPoints;
  final List<CandidateAction> actions;
  final String? reply;

  Map<String, dynamic> toJson() => {
    if (title != null) 'title': title,
    if (summary != null) 'summary': summary,
    if (keyPoints.isNotEmpty) 'keyPoints': keyPoints,
    if (actions.isNotEmpty)
      'actions': actions.map((action) => action.toJson()).toList(),
    if (reply != null) 'reply': reply,
  };
}

class CandidateAction {
  const CandidateAction({
    required this.title,
    this.owner,
    this.dueAt,
    this.evidence,
    this.confidence,
  });

  factory CandidateAction.fromJson(Map<String, dynamic> json) {
    return CandidateAction(
      title: json['title'] as String,
      owner: json['owner'] as String?,
      dueAt: json['dueAt'] == null
          ? null
          : DateTime.parse(json['dueAt'] as String).toUtc(),
      evidence: json['evidence'] as String?,
      confidence: (json['confidence'] as num?)?.toDouble(),
    );
  }

  final String title;
  final String? owner;
  final DateTime? dueAt;
  final String? evidence;
  final double? confidence;

  Map<String, dynamic> toJson() => {
    'title': title,
    if (owner != null) 'owner': owner,
    if (dueAt != null) 'dueAt': dueAt!.toIso8601String(),
    if (evidence != null) 'evidence': evidence,
    if (confidence != null) 'confidence': confidence,
  };
}

enum ToolName {
  createItem,
  updateItem,
  deleteItem,
  completeItem,
  searchItems,
  finish;

  static ToolName fromWire(String value) => switch (value) {
    'create_item' => ToolName.createItem,
    'update_item' => ToolName.updateItem,
    'delete_item' => ToolName.deleteItem,
    'complete_item' => ToolName.completeItem,
    'search_items' => ToolName.searchItems,
    'finish' => ToolName.finish,
    _ => throw FormatException('Unknown tool name: $value'),
  };

  String get wire => switch (this) {
    ToolName.createItem => 'create_item',
    ToolName.updateItem => 'update_item',
    ToolName.deleteItem => 'delete_item',
    ToolName.completeItem => 'complete_item',
    ToolName.searchItems => 'search_items',
    ToolName.finish => 'finish',
  };

  String get label => switch (this) {
    ToolName.createItem => '创建事项',
    ToolName.updateItem => '修改事项',
    ToolName.deleteItem => '删除事项',
    ToolName.completeItem => '完成事项',
    ToolName.searchItems => '查询事项',
    ToolName.finish => '整理完成',
  };
}

class ToolCall {
  const ToolCall({
    required this.id,
    required this.name,
    required this.arguments,
    required this.result,
    required this.createdAt,
  });

  factory ToolCall.fromJson(Map<String, dynamic> json) {
    return ToolCall(
      id: json['id'] as String,
      name: ToolName.fromWire(json['name'] as String),
      arguments: Map<String, dynamic>.from(
        json['arguments'] as Map? ?? const {},
      ),
      result: Map<String, dynamic>.from(json['result'] as Map? ?? const {}),
      createdAt: DateTime.parse(json['createdAt'] as String).toUtc(),
    );
  }

  final String id;
  final ToolName name;
  final Map<String, dynamic> arguments;
  final Map<String, dynamic> result;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name.wire,
    'arguments': arguments,
    'result': result,
    'createdAt': createdAt.toIso8601String(),
  };
}

class Usage {
  const Usage({
    required this.used,
    required this.limit,
    required this.unlimited,
    required this.date,
    required this.resetsAt,
  });

  factory Usage.fromJson(Map<String, dynamic> json) {
    return Usage(
      used: (json['used'] as num).toInt(),
      limit: (json['limit'] as num).toInt(),
      unlimited: json['unlimited'] as bool,
      date: json['date'] as String,
      resetsAt: DateTime.parse(json['resetsAt'] as String).toUtc(),
    );
  }

  final int used;
  final int limit;
  final bool unlimited;
  final String date;
  final DateTime resetsAt;

  Map<String, dynamic> toJson() => {
    'used': used,
    'limit': limit,
    'unlimited': unlimited,
    'date': date,
    'resetsAt': resetsAt.toIso8601String(),
  };
}

class SendMessageResult {
  const SendMessageResult({
    required this.userMessage,
    required this.assistantMessage,
    required this.toolCalls,
    required this.items,
    required this.usage,
  });

  factory SendMessageResult.fromJson(Map<String, dynamic> json) {
    return SendMessageResult(
      userMessage: ChatMessage.fromJson(
        json['userMessage'] as Map<String, dynamic>,
      ),
      assistantMessage: ChatMessage.fromJson(
        json['assistantMessage'] as Map<String, dynamic>,
      ),
      toolCalls: (json['toolCalls'] as List<dynamic>)
          .map((entry) => ToolCall.fromJson(entry as Map<String, dynamic>))
          .toList(),
      items: (json['items'] as List<dynamic>)
          .map((entry) => Item.fromJson(entry as Map<String, dynamic>))
          .toList(),
      usage: Usage.fromJson(json['usage'] as Map<String, dynamic>),
    );
  }

  final ChatMessage userMessage;
  final ChatMessage assistantMessage;
  final List<ToolCall> toolCalls;
  final List<Item> items;
  final Usage usage;

  Map<String, dynamic> toJson() => {
    'userMessage': userMessage.toJson(),
    'assistantMessage': assistantMessage.toJson(),
    'toolCalls': toolCalls.map((call) => call.toJson()).toList(),
    'items': items.map((item) => item.toJson()).toList(),
    'usage': usage.toJson(),
  };
}
