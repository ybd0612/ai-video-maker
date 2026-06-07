import { useRef, useCallback, useEffect, type TextareaHTMLAttributes } from "react";

/**
 * IMEAwareTextarea — textarea that correctly handles CJK IME composition.
 *
 * During IME composition (compositionstart → compositionend), the controlled
 * `value` is NOT pushed back to the DOM, so the browser's IME candidate window
 * stays intact.  Once composition ends, the final value is committed via onChange.
 */
interface IMEAwareTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

export function IMEAwareTextarea({ value, onChange, ...rest }: IMEAwareTextareaProps) {
  const composingRef = useRef(false);
  const localRef = useRef(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep localRef in sync when external value changes (e.g. task switch)
  useEffect(() => {
    if (!composingRef.current) {
      localRef.current = value;
    }
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      localRef.current = v;
      if (!composingRef.current) {
        onChange(v);
      }
    },
    [onChange],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      composingRef.current = false;
      const v = e.currentTarget.value;
      localRef.current = v;
      onChange(v);
    },
    [onChange],
  );

  return (
    <textarea
      ref={textareaRef}
      value={composingRef.current ? localRef.current : value}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      {...rest}
    />
  );
}