class NotaUser {
  const NotaUser({required this.email, required this.isVip});

  factory NotaUser.fromJson(Map<String, dynamic> json) {
    return NotaUser(
      email: json['email'] as String,
      isVip: json['isVip'] as bool,
    );
  }

  final String email;
  final bool isVip;

  Map<String, dynamic> toJson() => {'email': email, 'isVip': isVip};
}

class AuthResult {
  const AuthResult({required this.token, required this.user});

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    return AuthResult(
      token: json['token'] as String,
      user: NotaUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  final String token;
  final NotaUser user;

  Map<String, dynamic> toJson() => {'token': token, 'user': user.toJson()};
}
