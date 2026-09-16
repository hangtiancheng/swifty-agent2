import { CatIcon } from "~/components/cat-icon";
import { BtnLink } from "~/components/ui";


export function meta() {
  return [{ title: "喵喵优选 · 页面不存在" }];
}

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md border-4 border-ink bg-cream p-6 text-center shadow-hard-lg">
        <div className="mx-auto w-fit border-4 border-ink bg-paper p-2.5 shadow-hard">
          <CatIcon className="h-16 w-16" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-widest">404</h1>
        <p className="mt-2 text-[13px] leading-6 text-muted">
          这个页面走丢了喵~去聊天页问问小喵,或者回后台首页逛逛。
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <BtnLink to="/" variant="go">
            回聊天页
          </BtnLink>
          <BtnLink to="/admin">后台首页</BtnLink>
        </div>
      </div>
    </main>
  );
}
