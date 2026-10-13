import os
import sys

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QLabel,
    QTextBrowser,
    QVBoxLayout,
)


def _resource_path(filename: str) -> str:
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            base_dir = sys._MEIPASS
        else:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "../Resources"))
        return os.path.join(base_dir, filename)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", filename))


def load_disclaimer_text() -> str:
    path = _resource_path("DISCLAIMER.txt")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    return (
        "Приложение предоставляется как есть. Пользователь использует его добровольно "
        "и на свой риск. Полный файл DISCLAIMER.txt не найден."
    )


class DisclaimerDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Условия использования и отказ от ответственности")
        self.setModal(True)
        self.resize(760, 620)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(12)

        title = QLabel("Перед первым запуском нужно принять условия использования")
        title.setWordWrap(True)
        title.setStyleSheet("font-size: 18px; font-weight: 700;")
        layout.addWidget(title)

        intro = QLabel(
            "Пожалуйста, внимательно прочитайте уведомление ниже. "
            "Без подтверждения согласия приложение не откроется."
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)

        browser = QTextBrowser()
        browser.setPlainText(load_disclaimer_text())
        browser.setReadOnly(True)
        layout.addWidget(browser, 1)

        self.checkbox = QCheckBox(
            "Я прочитал(а), понял(а) условия и принимаю использование приложения на свой риск."
        )
        self.checkbox.stateChanged.connect(self._sync_accept_state)
        layout.addWidget(self.checkbox)

        buttons = QDialogButtonBox()
        self.accept_button = buttons.addButton("Согласен", QDialogButtonBox.ButtonRole.AcceptRole)
        self.reject_button = buttons.addButton("Не согласен", QDialogButtonBox.ButtonRole.RejectRole)
        self.accept_button.setEnabled(False)
        self.accept_button.clicked.connect(self.accept)
        self.reject_button.clicked.connect(self.reject)
        layout.addWidget(buttons)

        note = QLabel(
            "Совет: полный текст также доступен в файле DISCLAIMER.txt и во вкладке «О программе»."
        )
        note.setWordWrap(True)
        note.setAlignment(Qt.AlignmentFlag.AlignLeft)
        note.setStyleSheet("color: #7A8798; font-size: 12px;")
        layout.addWidget(note)

    def _sync_accept_state(self):
        self.accept_button.setEnabled(self.checkbox.isChecked())

