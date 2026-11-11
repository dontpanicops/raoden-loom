import { useEffect, useRef, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import {
  activeCanvasNavigationModifiers,
  canvasNavigationMouseButtonFromDomButton,
  canvasOverrideBindingConflicts,
  canvasNavigationModifierFromKey,
  formatCanvasNavigationBinding,
  normalizeCanvasNavigationInputKey,
  normalizeCanvasOverrideBinding,
  type CanvasNavigationModifier
} from "../../../../shared/canvasNavigation";
import { t } from "../../lib/i18n";
import { displayCanvasNavigationBinding } from "../../lib/shortcuts";

interface CanvasNavigationShortcutEditorProps {
  open: boolean;
  locale: LocaleId;
  label: string;
  binding: string | null;
  actionShortcuts: readonly string[];
  allowDisable?: boolean;
  onCaptureStart(): void;
  onChange(binding: string | null): Promise<void>;
}

export function CanvasNavigationShortcutEditor({
  open,
  locale,
  label,
  binding,
  actionShortcuts,
  allowDisable = true,
  onCaptureStart,
  onChange
}: CanvasNavigationShortcutEditorProps): React.JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modifiersRef = useRef<Set<CanvasNavigationModifier>>(new Set());
  const commitInFlight = useRef(false);
  const isMacOS = window.canvasTTY.window.isMacOS;

  useEffect(() => {
    if (open || !capturing) return;
    window.canvasTTY.canvasNavigation.setShortcutCaptureActive(false);
    modifiersRef.current.clear();
    setPreview(null);
    setError(null);
    setCapturing(false);
  }, [capturing, open]);

  useEffect(() => {
    const active = open && capturing;
    window.canvasTTY.canvasNavigation.setShortcutCaptureActive(active);
    return () => {
      if (active) window.canvasTTY.canvasNavigation.setShortcutCaptureActive(false);
    };
  }, [capturing, open]);

  const stopCapture = (): void => {
    window.canvasTTY.canvasNavigation.setShortcutCaptureActive(false);
    modifiersRef.current.clear();
    setPreview(null);
    setError(null);
    setCapturing(false);
  };

  const beginCapture = (): void => {
    if (commitInFlight.current) return;
    onCaptureStart();
    window.canvasTTY.canvasNavigation.setShortcutCaptureActive(true);
    modifiersRef.current.clear();
    setPreview(null);
    setError(null);
    setCapturing(true);
  };

  const save = async (key: string | null): Promise<void> => {
    if (commitInFlight.current) return;
    const candidate = formatCanvasNavigationBinding({ modifiers: [...modifiersRef.current], key });
    const normalized = normalizeCanvasOverrideBinding(candidate);
    if (!normalized) {
      modifiersRef.current.clear();
      setPreview(null);
      setError(t(locale, "canvasOverrideShortcutInvalid"));
      return;
    }
    if (actionShortcuts.some((shortcut) => canvasOverrideBindingConflicts(normalized, shortcut))) {
      modifiersRef.current.clear();
      setPreview(null);
      setError(t(locale, "shortcutConflict"));
      return;
    }

    commitInFlight.current = true;
    stopCapture();
    try {
      await onChange(normalized);
    } finally {
      commitInFlight.current = false;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopCapture();
      return;
    }

    const modifier = canvasNavigationModifierFromKey(event.key);
    if (modifier) {
      modifiersRef.current.add(modifier);
      setPreview(displayCanvasNavigationBinding(
        formatCanvasNavigationBinding({ modifiers: [...modifiersRef.current], key: null }),
        isMacOS
      ));
      return;
    }

    for (const eventModifier of activeCanvasNavigationModifiers(event)) {
      modifiersRef.current.add(eventModifier);
    }
    const key = normalizeCanvasNavigationInputKey(event.key, event.code);
    if (!key || modifiersRef.current.size === 0) {
      setError(t(locale, "canvasOverrideShortcutInvalid"));
      return;
    }
    setPreview(displayCanvasNavigationBinding(
      formatCanvasNavigationBinding({ modifiers: [...modifiersRef.current], key }),
      isMacOS
    ));
    void save(key);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canvasNavigationModifierFromKey(event.key) || modifiersRef.current.size === 0) return;
    void save(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!capturing) return;
    const button = canvasNavigationMouseButtonFromDomButton(event.button);
    if (button === null) return;
    event.preventDefault();
    event.stopPropagation();
    for (const eventModifier of activeCanvasNavigationModifiers(event)) {
      modifiersRef.current.add(eventModifier);
    }
    setPreview(displayCanvasNavigationBinding(
      formatCanvasNavigationBinding({ modifiers: [...modifiersRef.current], key: button }),
      isMacOS
    ));
    void save(button);
  };

  return (
    <>
      <div className="shortcut-editor">
        <div className="shortcut-editor__row">
          <span>{label}</span>
          <div className="shortcut-editor__actions">
            <button
              className={capturing
                ? "shortcut-editor__key shortcut-editor__key--capturing"
                : "shortcut-editor__key"}
              type="button"
              data-shortcut-capture="true"
              onClick={beginCapture}
              onBlur={() => {
                if (capturing) stopCapture();
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onPointerDown={handlePointerDown}
              onAuxClick={(event) => {
                if (!capturing || canvasNavigationMouseButtonFromDomButton(event.button) === null) return;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {capturing
                ? (preview ?? t(locale, "shortcutPress"))
                : binding === null
                  ? t(locale, "disabled")
                  : displayCanvasNavigationBinding(binding, isMacOS)}
            </button>
            <button
              className="shortcut-editor__edit"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={capturing ? stopCapture : beginCapture}
            >{capturing ? t(locale, "cancel") : t(locale, "shortcutEdit")}</button>
            {allowDisable && binding !== null && !capturing && (
              <button
                className="shortcut-editor__clear"
                type="button"
                onClick={() => {
                  stopCapture();
                  void onChange(null);
                }}
              >{t(locale, "disable")}</button>
            )}
          </div>
        </div>
      </div>
      {capturing && <p className="shortcut-editor__capture-hint">{t(locale, "canvasNavigationCaptureHint")}</p>}
      {error && <p className="shortcut-editor__error" role="alert">{error}</p>}
    </>
  );
}
