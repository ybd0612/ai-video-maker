import { useState, useCallback, useEffect, useRef, type InputHTMLAttributes } from "react";

/**
 * NumberInput — 数字输入框组件
 *
 * 使用本地 state 编辑，仅在 blur 或 Enter 键时将值提交到外部。
 * 这避免了 <input type="number"> 的上下按钮在按住时
 * 连续触发 onChange 导致快速滚动的问题。
 */
interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onChange: (value: number) => void;
}

export function NumberInput({ value, onChange, className, ...rest }: NumberInputProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const committedRef = useRef(value);

  // 当外部 value 变化时（如撤销、其他来源更新），同步到 local
  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      setLocalValue(String(value));
    }
  }, [value]);

  const commit = useCallback(() => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed) && parsed !== committedRef.current) {
      committedRef.current = parsed;
      onChange(parsed);
    } else {
      // 恢复为合法值
      setLocalValue(String(committedRef.current));
    }
  }, [localValue, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        (e.target as HTMLInputElement).blur();
      }
    },
    [],
  );

  return (
    <input
      type="number"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={className}
      {...rest}
    />
  );
}