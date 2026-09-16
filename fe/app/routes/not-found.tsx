import { Cat } from "lucide-react";

import { BtnLink } from "~/components/ui";


export function meta() {
  return [{ title: "MewMart · Not Found" }];
}

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md border-4 border-ink bg-cream p-6 text-center shadow-hard-lg">
        <div className="mx-auto w-fit border-4 border-ink bg-paper p-2.5 shadow-hard">
          <Cat className="h-16 w-16" strokeWidth={1.5} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-widest">404</h1>
        <p className="mt-2 text-[13px] leading-6 text-muted">
          This page does not exist. Ask the AI Assistant on the chat page, or
          head back to the Admin Console.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <BtnLink to="/" variant="go">
            Back to chat
          </BtnLink>
          <BtnLink to="/admin">Admin Console</BtnLink>
        </div>
      </div>
    </main>
  );
}
