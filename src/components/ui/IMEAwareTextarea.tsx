import { useRef, useEffect, type TextareaHTMLAttributes } from "react";

/**
 * IMEAwareTextarea — textarea that correctly handles CJK IME composition.
 *
 * Uses an uncontrolled textarea internally so that React re-renders from
 * external state changes (e.g. Zustand store) don't reset the DOM value
 * mid-composition.  The value is synced via ref when the external `value`
 * prop changes from a different source (e.g. task switch).
 */
interface IMEAwareTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

export function IMEAwareTextarea({ value, onChange, ...rest }: IMEAwareTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const lastExternalRef = useRef(value);
  const committedRef = useRef(value);

  // Sync DOM when external value changes from a DIFFERENT source
  // (e.g. task switch, undo), but NOT from our own onChange callback.
  useEffect(() => {
    if (value !== lastExternalRef.current) {
      lastExternalRef.current = value;
      if (!composingRef.current) {
        committedRef.current = value;
        if (textareaRef.current && textareaRef.current.value !== value) {
          textareaRef.current.value = value;
        }
      }
    }
  }, [value]);

  const handleChange = () => {
    const v = textareaRef.current?.value ?? "";
    if (!composingRef.current) {
      committedRef.current = v;
      lastExternalRef.current = v;
      onChange(v);
    }
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    const v = textareaRef.current?.value ?? "";
    committedRef.current = v;
    lastExternalRef.current = v;
    onChange(v);
  };

  return (
    <textarea
      ref={textareaRef}
      defaultValue={value}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      {...rest}
    />
  );
}