"use client";

/**
 * Выпадающее меню, которое всегда открывается ПОВЕРХ всего интерфейса.
 *
 * Проблема, которую решает: .glass-card использует backdrop-filter и потому
 * образует собственный stacking context. Меню с z-30 внутри такой карточки
 * целиком проигрывает следующей карточке (она позже в DOM со своим контекстом)
 * — меню «прячется» за нижними блоками (скрин пользователя: «SRT — субтитры»
 * виден только в щели между карточками).
 *
 * Решение: панель меню рендерится в createPortal(document.body) с
 * position: fixed — ни стекинг-контексты карточек, ни overflow-обрезка
 * предков на неё не действуют. Позиция считается от кнопки-якоря и
 * пересчитывается при скролле/реcайзе; у краёв экрана меню переворачивается
 * вверх и ограничивается по высоте.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function DropdownPanel({
  open,
  anchorRef,
  onClose,
  minWidth = 180,
  children,
}: {
  open: boolean;
  /** Ref элемента-якоря (обёртка или кнопка) — от его rect позиционируется панель. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  minWidth?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const ph = panelRef.current?.offsetHeight ?? 0;
    const gap = 4;
    // Меню падает вниз от кнопки; если снизу не влезает — раскрывается вверх.
    let top = r.bottom + gap;
    if (ph > 0 && top + ph > vh - 8 && r.top - gap - ph > 8) {
      top = r.top - gap - ph;
    }
    const maxHeight = Math.max(120, Math.min(vh - top - 8, 320));
    // Правый край меню = правый край кнопки (как было в absolute-версии),
    // с защитой от выхода за левый край экрана.
    const right = Math.max(vw - r.right, Math.min(minWidth + 12, vw - 12));
    setPos({ top, right, maxHeight });
  }, [anchorRef, minWidth]);

  // Пересчёт при открытии и после первого рендера (когда известна высота панели).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    // Высота панели становится известна после монтирования содержимого.
    const raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    // capture: true — ловим и скроллы во внутренних контейнерах (список сегментов и т.п.)
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, update, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Невидимая подложка на весь экран: клик мимо меню закрывает его */}
      <div className="fixed inset-0 z-[90]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: pos?.top ?? -9999,
          right: pos?.right ?? -9999,
          minWidth,
          maxHeight: pos?.maxHeight ?? 320,
          visibility: pos ? "visible" : "hidden",
        }}
        className="z-[100] rounded-xl border border-[#263147] bg-[#151b28] shadow-2xl overflow-y-auto overscroll-contain"
      >
        {children}
      </div>
    </>,
    document.body
  );
}
