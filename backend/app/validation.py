def validate_password(password: str) -> bool:
    """Пароль от 8 до 64 символов."""
    return 7 <= len(password) <= 64
