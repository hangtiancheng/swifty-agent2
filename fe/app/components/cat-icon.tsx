/** 像素猫:项目吉祥物。深色块用 currentColor,跟随主题 ink 色翻转;
 *  橘色脸与粉鼻子是品牌色,两种模式下保持不变。 */
export function CatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="4" height="4" fill="currentColor" />
      <rect x="10" y="2" width="4" height="4" fill="currentColor" />
      <rect x="2" y="4" width="12" height="9" fill="currentColor" />
      <rect x="3" y="3" width="2" height="3" fill="#ff9f57" />
      <rect x="11" y="3" width="2" height="3" fill="#ff9f57" />
      <rect x="3" y="5" width="10" height="7" fill="#ff9f57" />
      <rect x="5" y="7" width="1" height="2" fill="#2b2632" />
      <rect x="10" y="7" width="1" height="2" fill="#2b2632" />
      <rect x="7" y="9" width="2" height="1" fill="#ff8095" />
      <rect x="4" y="10" width="1" height="1" fill="#ffd7a8" />
      <rect x="11" y="10" width="1" height="1" fill="#ffd7a8" />
    </svg>
  );
}
