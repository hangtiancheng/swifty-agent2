import { Cat } from "lucide-react";
import { motion } from "motion/react";

import { BtnLink } from "~/components/ui";
import { enterTransition } from "~/lib/motion";

export function meta() {
  return [{ title: "MeowMeow Select · Not Found" }];
}

export default function NotFound() {
  return (
    <main className="bg-surface flex min-h-dvh items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enterTransition}
        className="bg-card shadow-e3 w-full max-w-md rounded-xl p-8 text-center"
      >
        <div className="bg-primary-container mx-auto grid h-24 w-24 place-items-center rounded-3xl">
          <Cat className="text-primary h-14 w-14" strokeWidth={1.5} />
        </div>
        <h1 className="text-headline-medium text-on-surface mt-6 font-medium">
          404
        </h1>
        <p className="text-body-medium text-on-surface-variant mt-2 leading-6">
          This page does not exist. Ask the AI Assistant on the chat page, or
          head back to the Admin Console.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <BtnLink to="/" variant="go">
            Back to chat
          </BtnLink>
          <BtnLink to="/admin">Admin Console</BtnLink>
        </div>
      </motion.div>
    </main>
  );
}
