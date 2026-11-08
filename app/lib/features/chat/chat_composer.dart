import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';
import 'chat_controller.dart';

/// 底部输入条：主对话、会议、未创建的会议草稿共用。
class ChatComposer extends StatefulWidget {
  const ChatComposer({
    super.key,
    required this.controller,
    required this.sending,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool sending;
  final Future<void> Function() onSend;

  @override
  State<ChatComposer> createState() => _ChatComposerState();
}

class _ChatComposerState extends State<ChatComposer> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void didUpdateWidget(ChatComposer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onTextChanged);
      widget.controller.addListener(_onTextChanged);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  void _onTextChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.controller.text;
    final overLimit = text.length > maxMessageLength;
    final canSend = !widget.sending && text.trim().isNotEmpty && !overLimit;

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        decoration: const BoxDecoration(
          color: AppColors.paper,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 860),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        key: const ValueKey('chat-input'),
                        controller: widget.controller,
                        minLines: 1,
                        maxLines: 5,
                        maxLength: maxMessageLength,
                        maxLengthEnforcement: MaxLengthEnforcement.none,
                        keyboardType: TextInputType.multiline,
                        textInputAction: TextInputAction.newline,
                        decoration: const InputDecoration(
                          hintText: '记下一句话，或粘贴会议文字…',
                          counterText: '',
                        ),
                        buildCounter:
                            (
                              context, {
                              required currentLength,
                              required isFocused,
                              required maxLength,
                            }) {
                              return Padding(
                                padding: const EdgeInsets.only(top: 5, left: 4),
                                child: Text(
                                  '$currentLength / $maxLength',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: currentLength > maxMessageLength
                                        ? AppColors.danger
                                        : AppColors.muted,
                                  ),
                                ),
                              );
                            },
                      ),
                    ),
                    const SizedBox(width: 10),
                    IconButton.filled(
                      key: const ValueKey('chat-send'),
                      onPressed: canSend ? widget.onSend : null,
                      tooltip: '发送',
                      icon: widget.sending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.arrow_upward, size: 20),
                    ),
                  ],
                ),
                if (overLimit)
                  const Padding(
                    padding: EdgeInsets.only(left: 4, top: 2),
                    child: Text(
                      '单条消息最多 20,000 字，请精简后再发送',
                      style: TextStyle(fontSize: 12, color: AppColors.danger),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
