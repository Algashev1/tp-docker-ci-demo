from app.validation import validate_password


def test_password_min_length_ok():
    assert validate_password("a" * 8)


def test_password_too_short():
    assert not validate_password("a" * 7)


def test_password_max_length_ok():
    assert validate_password("a" * 64)


def test_password_too_long():
    assert not validate_password("a" * 65)
