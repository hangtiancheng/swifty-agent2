// Minimal ambient declaration for @huggingface/tokenizers.
//
// Why this file exists: @huggingface/tokenizers@0.2.0 ships `"type": "module"` but its
// types/index.d.ts re-exports with extensionless relative specifiers ("./core/Tokenizer"),
// which do NOT resolve under this repo's `moduleResolution: nodenext` ESM mode. tsc hides the
// resulting broken types behind `skipLibCheck`, but the type-aware lint rules see an unresolved
// `error` type and reject every use. The runtime is fine (the .mjs loads and works); only the
// bundled declarations are broken.
//
// This global ambient module shadows the broken package types with the exact surface we use,
// restoring real typing without any `as` casts or lint disables. Keep it in sync with the
// verified runtime API (Tokenizer constructor + encode).
declare module "@huggingface/tokenizers" {
  export interface Encoding {
    ids: number[];
    tokens: string[];
    attention_mask: number[];
    token_type_ids?: number[];
  }

  export interface EncodeOptions {
    text_pair?: string | null;
    add_special_tokens?: boolean;
    return_token_type_ids?: boolean | null;
  }

  export interface DecodeOptions {
    skip_special_tokens?: boolean;
    clean_up_tokenization_spaces?: boolean | null;
  }

  export class Tokenizer {
    // tokenizer = parsed tokenizer.json; config = parsed tokenizer_config.json (optional, {} ok).
    constructor(tokenizer: object, config: object);
    encode(text: string, options?: EncodeOptions): Encoding;
    decode(tokenIds: number[], options?: DecodeOptions): string;
    tokenize(text: string, options?: { text_pair?: string | null; add_special_tokens?: boolean }): string[];
    token_to_id(token: string): number | undefined;
    id_to_token(id: number): string | undefined;
    get_vocab(withAddedTokens?: boolean): Map<string, number>;
  }
}
