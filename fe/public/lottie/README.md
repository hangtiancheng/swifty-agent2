# Lottie assets

Decorative animations played by `@lottiefiles/dotlottie-web` (see
`app/components/lottie.tsx`). Each `.lottie` file is a dotLottie archive
(zip: `manifest.json` + `animations/animation.json`) packaged from the
official LottieFiles sample fixtures shipped in the
[LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web)
repository (`fixtures/` directory, MIT-licensed project).

| File              | Source fixture                      | Used for                           |
| ----------------- | ----------------------------------- | ---------------------------------- |
| `cat-hero.lottie` | `lottie/cat_loader.json`            | Chat empty-state hero, boot splash |
| `loading.lottie`  | `lottie/material_wave_loading.json` | Inline loading indicators          |
| `yarn.lottie`     | `lottie/yarn_loading.json`          | Page-level loading state           |
| `success.lottie`  | `lottie/confetti2.json`             | Success feedback moments           |
| `empty.lottie`    | `lottie/open_envelope.json`         | Empty / no-data states             |
| `notfound.lottie` | `lottie/error_404.json`             | 404 page                           |

The player WASM is self-hosted at `public/wasm/dotlottie-player.wasm`
(copied from `@lottiefiles/dotlottie-web/dist`) and wired up via
`DotLottie.setWasmUrl()` in `app/main.ts`, so no CDN is required at runtime.
