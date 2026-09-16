/** className 拼接:过滤假值,轻量替代 clsx */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
